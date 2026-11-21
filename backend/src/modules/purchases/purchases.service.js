import * as model from './purchases.model.js';
import * as productsModel from '../products/products.model.js';
import { assertManager } from '../collection-points/collection-points.service.js';
import { applyMovement, afterMovement } from '../storage/storage.service.js';
import { notify, NotificationTypes } from '../notifications/notifications.service.js';
import { emitToUsers } from '../../socket/index.js';
import { SocketEvents } from '../../socket/events.js';
import { transaction } from '../../config/db.js';
import { ApiError, found } from '../../utils/ApiError.js';
import { paginated, paginationOf } from '../../utils/pagination.js';

/**
 * Status workflow:
 *   pending   → confirmed (seller or collector) | cancelled (both)
 *   confirmed → received  (collector — stock is added automatically) | cancelled (both)
 */
const TRANSITIONS = {
  pending: { confirmed: ['seller', 'collector'], cancelled: ['seller', 'collector'] },
  confirmed: { received: ['collector'], cancelled: ['seller', 'collector'] },
};

const STATUS_LABELS = { confirmed: 'confirmée', received: 'réceptionnée', cancelled: 'annulée' };

const toKg = (qty, unit) => Number(qty) * (unit === 't' ? 1000 : 1);

/** Enforces the listing's available quantity and minimum order on a purchase. */
function assertListingQuantity(product, quantityKg) {
  if (!product) return;
  const comparable = (value) => (product.unit === 'unit' ? null : toKg(value, product.unit));
  const available = comparable(product.quantity_available);
  if (available !== null && quantityKg > available) {
    throw ApiError.conflict(`Quantité supérieure au stock annoncé (${product.quantity_available} ${product.unit})`);
  }
  const min = product.min_order_quantity == null ? null : comparable(product.min_order_quantity);
  if (min !== null && quantityKg < min) {
    throw ApiError.conflict(`Quantité inférieure au minimum de commande (${product.min_order_quantity} ${product.unit})`);
  }
}

/**
 * Price the listing allows for this exact order: a discount only counts once
 * the ordered quantity reaches its own min_quantity.
 */
function priceForQuantity(product, quantityKg) {
  if (!product || product.price_per_unit == null) return null;
  const qty = product.unit === 't' ? Number(quantityKg) / 1000 : Number(quantityKg);
  const best = (product.active_discounts ?? []).reduce((max, d) => (
    d.min_quantity == null || Number(d.min_quantity) <= qty ? Math.max(max, Number(d.percentage)) : max
  ), 0);
  return Number((Number(product.price_per_unit) * (1 - best / 100)).toFixed(3));
}

/** A purchase must carry a positive price, never above the price allowed for its quantity. */
function assertUnitPrice(unitPrice, product, quantityKg) {
  if (unitPrice === null || unitPrice === undefined) throw ApiError.badRequest('unit_price est requis');
  const price = Number(unitPrice);
  if (!(price > 0)) throw ApiError.badRequest('unit_price doit être supérieur à 0');
  const announced = priceForQuantity(product, quantityKg);
  if (announced != null && announced > 0 && price > announced) {
    throw ApiError.badRequest(`unit_price dépasse le prix annoncé (${announced} TND ${product.unit})`);
  }
}

function partyOf(user, purchase) {
  if (user.role === 'admin') return 'admin';
  if (purchase.collection_point.manager_id === user.id) return 'collector';
  if (purchase.seller?.id === user.id) return 'seller';
  return null;
}

async function getVisible(user, id) {
  const purchase = found(await model.findById(id), 'Opération d\'achat introuvable');
  if (!partyOf(user, purchase)) throw ApiError.forbidden('Vous ne participez pas à cette opération');
  return purchase;
}

/** US-PC01 — purchase operations (collector sees its points, seller sees what is bought from it). */
export async function list(user, filters) {
  const page = paginationOf(filters);
  return paginated(await model.list(user, filters, page), page);
}

export const getById = (user, id) => getVisible(user, id);

export async function create(user, data) {
  await assertManager(user, data.collection_point_id);
  const payload = { ...data };
  let product = null;
  if (data.product_id) {
    product = found(await productsModel.findById(data.product_id), 'Produit introuvable');
    if (!product.is_active) throw ApiError.conflict('Annonce désactivée : achat impossible');
    assertListingQuantity(product, Number(data.quantity_kg));
    payload.seller_id = product.seller_id;
    payload.category_id ??= product.category_id;
    payload.label ??= product.title;
    payload.unit_price ??= priceForQuantity(product, payload.quantity_kg) ?? undefined;
  }
  assertUnitPrice(payload.unit_price, product, payload.quantity_kg);
  if (!payload.label) throw ApiError.badRequest('label est requis quand aucun product_id n\'est fourni');
  const purchase = await model.findById(await model.create(user.id, payload));
  if (purchase.seller) {
    await notify(purchase.seller.id, {
      type: NotificationTypes.PURCHASE_NEW,
      title: 'Nouvelle proposition d\'achat',
      message: `${purchase.collection_point.name} souhaite acheter ${purchase.quantity_kg} kg de ${purchase.label}`,
      data: { purchase_id: purchase.id },
      link: `/purchases/${purchase.id}`,
    });
  }
  return purchase;
}

export async function update(user, id, data) {
  const purchase = await getVisible(user, id);
  if (partyOf(user, purchase) === 'seller') throw ApiError.forbidden('Seul le point de collecte peut modifier l\'opération');
  if (purchase.status !== 'pending') throw ApiError.conflict('Seule une opération en attente peut être modifiée');
  if (data.quantity_kg !== undefined || data.unit_price !== undefined) {
    const product = purchase.product_id ? await productsModel.findById(purchase.product_id) : null;
    const quantity = Number(data.quantity_kg ?? purchase.quantity_kg);
    if (product) assertListingQuantity(product, quantity);
    assertUnitPrice(data.unit_price !== undefined ? data.unit_price : purchase.unit_price, product, quantity);
  }
  await model.update(id, data);
  return model.findById(id);
}

export async function changeStatus(user, id, { status, stock_item_id: stockItemId }) {
  let movementResult = null;
  await transaction(async (db) => {
    const locked = found(await model.lock(id, db), 'Opération d\'achat introuvable');
    const purchase = await model.findById(id, db);
    const party = partyOf(user, purchase);
    if (!party) throw ApiError.forbidden('Vous ne participez pas à cette opération');
    const allowed = TRANSITIONS[locked.status]?.[status];
    if (!allowed) throw ApiError.conflict(`Transition impossible : ${locked.status} → ${status}`);
    // Without a registered seller, the collector handles confirmation alone.
    if (party !== 'admin' && !allowed.includes(party)) throw ApiError.forbidden(`Action réservée à : ${allowed.join(', ')}`);

    const changes = { status };
    if (status === 'received') {
      if (locked.product_id) {
        const consumed = await model.consumeProductQuantity(locked.product_id, locked.quantity_kg, db);
        if (!consumed.rowCount) {
          throw ApiError.conflict('Stock insuffisant sur l\'annonce produit : la quantité commandée n\'est plus disponible');
        }
      }
      movementResult = await applyMovement({
        pointId: locked.collection_point_id,
        itemId: stockItemId ?? locked.stock_item_id ?? undefined,
        label: locked.label,
        categoryId: locked.category_id,
        type: 'in',
        quantity: locked.quantity_kg,
        reason: `Achat ${locked.id}`,
        purchaseId: locked.id,
        userId: user.id,
      }, db);
      changes.received_at = new Date();
      changes.stock_item_id = movementResult.item.id;
    }
    await model.update(id, changes, db);
  });
  if (movementResult) await afterMovement(movementResult);

  const purchase = await model.findById(id);
  const participants = [purchase.collection_point.manager_id, purchase.seller?.id];
  emitToUsers(participants, SocketEvents.PURCHASE_UPDATED, purchase);
  await notify(participants.filter((uid) => uid !== user.id), {
    type: NotificationTypes.PURCHASE_STATUS,
    title: `Opération d'achat ${STATUS_LABELS[status]}`,
    message: `${purchase.label} — ${purchase.quantity_kg} kg (${purchase.collection_point.name})`,
    data: { purchase_id: id, status },
    link: `/purchases/${id}`,
  });
  return purchase;
}
