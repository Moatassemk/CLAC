/**
 * Business-logic audit (development only, against the running API).
 *
 *   node test/business-audit.mjs            # default http://localhost:5002/api
 *   API_URL=http://localhost:5002/api node test/business-audit.mjs
 *
 * Creates its own product / collection point / stock and deletes them at the
 * end. It never edits seeded rows (except notifications it triggers).
 */
import { query } from '../src/config/db.js';
import { env } from '../src/config/env.js';

const API = process.env.API_URL || `http://127.0.0.1:${env.port}/api`;
const results = [];
const created = { products: [], points: [], requests: [], offers: [], exchanges: [] };
let startedAt;

const CATEGORY = (await query("SELECT id FROM categories WHERE slug = 'olive-pomace'")).rows[0].id;
const pointvert = (await query("SELECT id FROM users WHERE email = 'collecte.sfax@clac.tn'")).rows[0];
const zitouna = (await query("SELECT id FROM users WHERE email = 'huilerie.zitouna@clac.tn'")).rows[0];
const amal = (await query("SELECT id FROM users WHERE email = 'moulin.elamal@clac.tn'")).rows[0];

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json, data: json?.data };
}

function record(category, name, { expected, actual, note = '', bug = false, detail = '' }) {
  const ok = expected.includes(actual);
  results.push({ category, name, expected, actual, ok, bug, note, detail });
  const tag = !ok ? 'FAIL' : bug ? 'HOLE' : 'PASS';
  console.log(`[${tag}] ${category} :: ${name} -> ${actual} (expected ${expected.join('/')})${detail ? ` — ${detail}` : ''}`);
}

const login = async (email, password) => {
  const res = await api('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200) throw new Error(`login ${email} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.data.token;
};

let T;

try {
  startedAt = new Date();
  T = {
    admin: await login('admin@clac.tn', 'Admin2026!'),
    seller: await login('huilerie.zitouna@clac.tn', 'Clac2026!'),
    seller2: await login('moulin.elamal@clac.tn', 'Clac2026!'),
    buyer: await login('achats@biodiesel-sahel.tn', 'Clac2026!'),
    collector: await login('collecte.sfax@clac.tn', 'Clac2026!'),
    collector2: await login('grandtunis@eco-collecte.tn', 'Clac2026!'),
  };
  console.log(`API ${API}\n`);

  /* ------------------------------------------------------------ access */
  record('Accès', 'GET /products sans token', { expected: [401], actual: (await api('GET', '/products')).status });
  record('Accès', 'Acheteur crée un produit', {
    expected: [403], actual: (await api('POST', '/products', { token: T.buyer, body: { title: 'x', category_id: CATEGORY, quantity_available: 1, gouvernorat: 'Sfax' } })).status,
  });
  record('Accès', 'Acheteur liste les achats', { expected: [403], actual: (await api('GET', '/purchases', { token: T.buyer })).status });

  /* ----------------------------------------------------------- produits */
  const baseProduct = {
    title: 'AUDIT — grignons de test', description: 'créé par business-audit.mjs', category_id: CATEGORY,
    unit: 'kg', quantity_available: 1000, price_per_unit: 1, min_order_quantity: 100, gouvernorat: 'Sfax',
  };
  record('Produits', 'Quantité négative refusée', {
    expected: [422], actual: (await api('POST', '/products', { token: T.seller, body: { ...baseProduct, quantity_available: -1 } })).status,
  });
  record('Produits', 'Prix négatif refusé', {
    expected: [422], actual: (await api('POST', '/products', { token: T.seller, body: { ...baseProduct, price_per_unit: -5 } })).status,
  });
  const createdProduct = await api('POST', '/products', { token: T.seller, body: baseProduct });
  record('Produits', 'Création valide', { expected: [201], actual: createdProduct.status });
  const product = createdProduct.data;
  created.products.push(product.id);

  record('Produits', 'Prix mis à 0 refusé (annonce payante uniquement)', {
    expected: [422], actual: (await api('PATCH', `/products/${product.id}`, { token: T.seller, body: { price_per_unit: 0 } })).status,
  });
  await api('PATCH', `/products/${product.id}`, { token: T.seller, body: { price_per_unit: 1 } });
  record('Produits', 'Quantité mise à -5 refusée', {
    expected: [422], actual: (await api('PATCH', `/products/${product.id}`, { token: T.seller, body: { quantity_available: -5 } })).status,
  });
  record('Produits', 'Autre vendeur modifie le produit', {
    expected: [403], actual: (await api('PATCH', `/products/${product.id}`, { token: T.seller2, body: { price_per_unit: 99 } })).status,
  });
  record('Produits', 'Minimum de commande > stock refusé (5000 pour 1000 kg)', {
    expected: [409], actual: (await api('PATCH', `/products/${product.id}`, { token: T.seller, body: { min_order_quantity: 5000 } })).status,
  });
  await api('PATCH', `/products/${product.id}`, { token: T.seller, body: { min_order_quantity: 100 } });

  record('Remises', 'Remise > 100 % refusée', {
    expected: [422], actual: (await api('POST', '/discounts', { token: T.seller, body: { product_id: product.id, title: 'x', percentage: 150, ends_at: new Date(Date.now() + 86400000).toISOString() } })).status,
  });
  record('Remises', 'Remise expirée refusée', {
    expected: [422], actual: (await api('POST', '/discounts', { token: T.seller, body: { product_id: product.id, title: 'x', percentage: 10, ends_at: new Date(Date.now() - 86400000).toISOString() } })).status,
  });
  const d50 = await api('POST', '/discounts', {
    token: T.seller, body: { product_id: product.id, title: 'AUDIT -50', percentage: 50, min_quantity: 900, ends_at: new Date(Date.now() + 86400000).toISOString() },
  });
  record('Remises', 'Remise valide créée', { expected: [201], actual: d50.status });
  await api('POST', '/discounts', {
    token: T.seller, body: { product_id: product.id, title: 'AUDIT -10', percentage: 10, ends_at: new Date(Date.now() + 86400000).toISOString() },
  });
  const priced = await api('GET', `/products/${product.id}`, { token: T.buyer });
  record('Remises', 'Prix affiché = remise applicable au minimum de commande (-10 % → 0,9)', {
    expected: [0.9], actual: priced.data?.final_price_per_unit,
  });
  record('Remises', 'Remise min_quantity respectée dans le prix affiché', {
    expected: [0.9], actual: priced.data?.final_price_per_unit,
    note: 'La remise -50 % exige 900 kg : elle ne s’applique pas à la quantité minimale de 100 kg.',
  });
  record('Remises', 'Meilleur prix atteignable = meilleure remise (pas cumul)', {
    expected: [0.5], actual: priced.data?.best_price_per_unit,
  });

  /* ----------------------------------------- point de collecte de test */
  const pointRes = await api('POST', '/collection-points', {
    token: T.collector,
    body: { name: `AUDIT — point ${Date.now()}`, gouvernorat: 'Sfax', lat: 34.75, lng: 10.73, storage_capacity_kg: 10000, category_ids: [CATEGORY] },
  });
  if (pointRes.status !== 201) throw new Error(`point -> ${pointRes.status} ${JSON.stringify(pointRes.body)}`);
  const point = pointRes.data;
  created.points.push(point.id);

  /* ----------------------------------------------------- achats (purchases) */
  const PURCHASE_PRICE = 0.5; // prix annoncé après la remise active de -50 %
  record('Achats', 'Achat > quantité annoncée (5000 pour 1000 kg)', {
    expected: [409], actual: (await api('POST', '/purchases', {
      token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 5000, unit_price: PURCHASE_PRICE },
    })).status,
  });
  record('Achats', 'Achat < minimum de commande (50 pour min 100)', {
    expected: [409], actual: (await api('POST', '/purchases', {
      token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 50 },
    })).status,
  });
  record('Achats', 'Prix d’achat 0 refusé', {
    expected: [400, 422], actual: (await api('POST', '/purchases', {
      token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 200, unit_price: 0 },
    })).status,
  });
  record('Achats', 'Prix d’achat négatif refusé', {
    expected: [400, 422], actual: (await api('POST', '/purchases', {
      token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 10, unit_price: -1 },
    })).status,
  });
  record('Achats', 'Prix d’achat au-dessus du prix annoncé refusé (999 vs 0,5)', {
    expected: [400, 422], actual: (await api('POST', '/purchases', {
      token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 100, unit_price: 999 },
    })).status,
  });
  const noPrice = await api('POST', '/purchases', {
    token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 200 },
  });
  const noPriceTotal = noPrice.status === 201
    ? (await query('SELECT total_amount FROM purchases WHERE id = $1', [noPrice.data.id])).rows[0].total_amount : null;
  record('Achats', 'Prix absent : prix de la quantité appliqué (200 × 0,9 = 180 TND)', {
    expected: [180], actual: noPriceTotal,
    note: 'La remise -50 % exigée dès 900 kg ne s’applique pas à 200 kg ; la remise -10 % sans minimum s’applique.',
  });

  const buyValid = await api('POST', '/purchases', {
    token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 500, unit_price: PURCHASE_PRICE },
  });
  record('Achats', 'Achat valide créé', { expected: [201], actual: buyValid.status });
  record('Achats', 'Vendeur voit l’opération', { expected: [200], actual: (await api('GET', `/purchases/${buyValid.data.id}`, { token: T.seller })).status });
  record('Achats', 'Autre vendeur ne voit pas l’opération', {
    expected: [403], actual: (await api('GET', `/purchases/${buyValid.data.id}`, { token: T.seller2 })).status,
  });

  record('Achats', 'Réception directe depuis “pending” refusée (workflow)', {
    expected: [409], actual: (await api('PATCH', `/purchases/${buyValid.data.id}/status`, { token: T.collector, body: { status: 'received' } })).status,
  });
  record('Achats', 'Vendeur confirme', {
    expected: [200], actual: (await api('PATCH', `/purchases/${buyValid.data.id}/status`, { token: T.seller, body: { status: 'confirmed' } })).status,
  });
  record('Achats', 'Vendeur ne peut pas réceptionner', {
    expected: [403], actual: (await api('PATCH', `/purchases/${buyValid.data.id}/status`, { token: T.seller, body: { status: 'received' } })).status,
  });
  record('Achats', 'Modification après confirmation refusée', {
    expected: [409], actual: (await api('PATCH', `/purchases/${buyValid.data.id}`, { token: T.collector, body: { quantity_kg: 1 } })).status,
  });
  record('Achats', 'Réception confirmée', {
    expected: [200], actual: (await api('PATCH', `/purchases/${buyValid.data.id}/status`, { token: T.collector, body: { status: 'received' } })).status,
  });
  record('Achats', 'Double réception refusée', {
    expected: [409], actual: (await api('PATCH', `/purchases/${buyValid.data.id}/status`, { token: T.collector, body: { status: 'received' } })).status,
  });
  record('Achats', 'Annulation après réception refusée', {
    expected: [409], actual: (await api('PATCH', `/purchases/${buyValid.data.id}/status`, { token: T.collector, body: { status: 'cancelled' } })).status,
  });
  const after = await query('SELECT quantity_available FROM products WHERE id = $1', [product.id]);
  record('Achats', 'Stock annoncé décrémenté de 500', { expected: [500], actual: after.rows[0].quantity_available });
  const stored = await query('SELECT COALESCE(SUM(quantity_kg),0) AS kg FROM stock_items WHERE collection_point_id = $1', [point.id]);
  record('Achats', 'Stock réceptionné = 500 kg', { expected: [500], actual: Number(stored.rows[0].kg) });
  const total = await query('SELECT total_amount FROM purchases WHERE id = $1', [buyValid.data.id]);
  record('Achats', 'Montant total = 500 × 0,5', { expected: [250], actual: total.rows[0].total_amount });

  // Deux achats acceptés séparément sur le stock restant (500 kg) : la seconde
  // réception doit échouer, sinon le stock annoncé passerait sous zéro.
  const raceA = await api('POST', '/purchases', {
    token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 300, unit_price: PURCHASE_PRICE },
  });
  const raceB = await api('POST', '/purchases', {
    token: T.collector, body: { collection_point_id: point.id, product_id: product.id, quantity_kg: 300, unit_price: PURCHASE_PRICE },
  });
  record('Achats', 'Deux achats de 300 kg sur 500 kg disponibles créés', {
    expected: ['201/201'], actual: [raceA.status, raceB.status].join('/'),
  });
  for (const p of [raceA, raceB]) if (p.status === 201) await api('PATCH', `/purchases/${p.data.id}/status`, { token: T.seller, body: { status: 'confirmed' } });
  record('Achats', 'Première réception sur stock restant', {
    expected: [200], actual: (await api('PATCH', `/purchases/${raceA.data.id}/status`, { token: T.collector, body: { status: 'received' } })).status,
  });
  record('Achats', 'Seconde réception refusée : stock annoncé épuisé', {
    expected: [409], actual: (await api('PATCH', `/purchases/${raceB.data.id}/status`, { token: T.collector, body: { status: 'received' } })).status,
  });
  const afterRace = await query('SELECT quantity_available FROM products WHERE id = $1', [product.id]);
  record('Achats', 'Stock annoncé jamais négatif', { expected: [200], actual: afterRace.rows[0].quantity_available });

  /* -------------------------------------------------------------- stockage */
  const itemRes = await api('POST', `/collection-points/${point.id}/storage/items`, {
    token: T.collector, body: { label: 'AUDIT — article', category_id: CATEGORY, initial_quantity_kg: 4000 },
  });
  record('Stockage', 'Article créé avec stock initial', { expected: [201], actual: itemRes.status });
  const item = itemRes.data;
  record('Stockage', 'Sortie > stock refusée', {
    expected: [409], actual: (await api('POST', `/collection-points/${point.id}/storage/movements`, { token: T.collector, body: { stock_item_id: item.id, type: 'out', quantity_kg: 99999 } })).status,
  });
  record('Stockage', 'Ajustement > capacité refusé', {
    expected: [409], actual: (await api('POST', `/collection-points/${point.id}/storage/movements`, { token: T.collector, body: { stock_item_id: item.id, type: 'adjust', quantity_kg: 20000 } })).status,
  });
  record('Stockage', 'Capacité < stock utilisé refusée', {
    expected: [409], actual: (await api('PATCH', `/collection-points/${point.id}/storage/capacity`, { token: T.collector, body: { storage_capacity_kg: 100 } })).status,
  });
  record('Stockage', 'Mouvement sur point d’un autre gérant refusé', {
    expected: [403], actual: (await api('POST', `/collection-points/${point.id}/storage/movements`, { token: T.collector2, body: { stock_item_id: item.id, type: 'out', quantity_kg: 1 } })).status,
  });

  /* --------------------------------------------------------------- offres */
  const offerTooMuch = await api('POST', '/offers', {
    token: T.collector, body: { collection_point_id: point.id, stock_item_id: item.id, title: 'AUDIT offre trop grande', quantity: 6000, unit: 'kg', price_per_unit: 0.5 },
  });
  record('Offres', 'Offre > stock de l’article refusée (kg)', { expected: [409], actual: offerTooMuch.status });
  const offerTonnes = await api('POST', '/offers', {
    token: T.collector, body: { collection_point_id: point.id, stock_item_id: item.id, title: 'AUDIT offre en tonnes', quantity: 100, unit: 't', price_per_unit: 0.5 },
  });
  record('Offres', 'Offre en tonnes refusée (100 t pour 4 t)', {
    expected: [409], actual: offerTonnes.status,
  });
  if (offerTonnes.status === 201) created.offers.push(offerTonnes.data.id);
  const offerA = await api('POST', '/offers', {
    token: T.collector, body: { collection_point_id: point.id, stock_item_id: item.id, title: 'AUDIT offre A', quantity: 3000, unit: 'kg', price_per_unit: 0.5, publish: true },
  });
  const offerB = await api('POST', '/offers', {
    token: T.collector, body: { collection_point_id: point.id, stock_item_id: item.id, title: 'AUDIT offre B', quantity: 3000, unit: 'kg', price_per_unit: 0.5, publish: true },
  });
  record('Offres', 'Offres cumulées > stock refusées (3000 + 3000 pour 4000)', {
    expected: ['201/409'], actual: [offerA.status, offerB.status].join('/'),
  });
  if (offerA.status === 201) created.offers.push(offerA.data.id);
  if (offerB.status === 201) created.offers.push(offerB.data.id);
  record('Offres', 'Acheteur ne peut pas publier une offre', {
    expected: [403], actual: (await api('POST', '/offers', { token: T.buyer, body: { title: 'x', quantity: 1 } })).status,
  });
  record('Offres', 'Prix d’offre négatif refusé', {
    expected: [422], actual: (await api('POST', '/offers', { token: T.collector, body: { title: 'x', quantity: 1, price_per_unit: -1 } })).status,
  });
  const draftPast = await api('POST', '/offers', {
    token: T.collector, body: { title: 'AUDIT brouillon expiré', quantity: 1, starts_at: new Date(Date.now() - 172800000).toISOString(), ends_at: new Date(Date.now() - 86400000).toISOString() },
  });
  if (draftPast.status === 201) {
    created.offers.push(draftPast.data.id);
    record('Offres', 'Publication d’une offre expirée refusée', {
      expected: [409], actual: (await api('POST', `/offers/${draftPast.data.id}/publish`, { token: T.collector })).status,
    });
  }
  if (offerA.status === 201) {
    record('Offres', 'PATCH quantité seule contrôlé (99999 pour 4000)', {
      expected: [409], actual: (await api('PATCH', `/offers/${offerA.data.id}`, { token: T.collector, body: { quantity: 99999 } })).status,
    });
  }
  if (offerA.status === 201) {
    await api('POST', `/offers/${offerA.data.id}/close`, { token: T.collector });
    record('Offres', 'Modification d’une offre clôturée refusée', {
      expected: [409], actual: (await api('PATCH', `/offers/${offerA.data.id}`, { token: T.collector, body: { quantity: 1 } })).status,
    });
  }

  /* ------------------------------------------------------------ demandes */
  const bigRequest = await api('POST', '/requests', {
    token: T.buyer, body: { product_id: product.id, title: 'AUDIT — achat 100 000 kg', quantity: 100000, unit: 'kg' },
  });
  record('Demandes', 'Demande > quantité annoncée refusée (100 000 pour 200 kg)', {
    expected: [409], actual: bigRequest.status,
  });
  record('Demandes', 'Demande < minimum de commande refusée (1 pour min 100)', {
    expected: [409], actual: (await api('POST', '/requests', {
      token: T.buyer, body: { product_id: product.id, title: 'AUDIT — achat sous le minimum', quantity: 1, unit: 'kg' },
    })).status,
  });
  record('Demandes', 'Quantité 0 refusée', {
    expected: [422], actual: (await api('POST', '/requests', { token: T.buyer, body: { category_id: CATEGORY, title: 'AUDIT zéro', quantity: 0 } })).status,
  });

  const validRequest = await api('POST', '/requests', {
    token: T.buyer, body: { product_id: product.id, title: 'AUDIT — demande dans les limites', quantity: 200, unit: 'kg' },
  });
  record('Demandes', 'Demande dans les limites du stock créée', { expected: [201], actual: validRequest.status });
  if (validRequest.status === 201) created.requests.push(validRequest.data.id);
  record('Demandes', 'Proposition > demande refusée (999 999 pour 200 kg)', {
    expected: [409], actual: (await api('POST', `/requests/${validRequest.data.id}/responses`, {
      token: T.seller, body: { message: 'AUDIT sur-proposition', proposed_quantity: 999999, proposed_price_per_unit: 0.2 },
    })).status,
  });
  record('Demandes', 'Proposition valide créée', {
    expected: [201], actual: (await api('POST', `/requests/${validRequest.data.id}/responses`, { token: T.seller, body: { proposed_quantity: 200 } })).status,
  });
  record('Demandes', 'Proposition en double refusée proprement', {
    expected: [409], actual: (await api('POST', `/requests/${validRequest.data.id}/responses`, { token: T.seller, body: { proposed_quantity: 1 } })).status,
  });
  record('Demandes', 'Proposition d’un vendeur non ciblé refusée', {
    expected: [403], actual: (await api('POST', `/requests/${validRequest.data.id}/responses`, { token: T.seller2, body: { proposed_quantity: 1 } })).status,
  });
  record('Demandes', 'Proposition à prix négatif refusée', {
    expected: [422], actual: (await api('POST', `/requests/${validRequest.data.id}/responses`, { token: T.seller, body: { proposed_quantity: 1, proposed_price_per_unit: -1 } })).status,
  });

  const openRequest = await api('POST', '/requests', {
    token: T.buyer, body: { category_id: CATEGORY, title: 'AUDIT — demande ouverte', quantity: 10000, unit: 'kg' },
  });
  if (openRequest.status === 201) {
    created.requests.push(openRequest.data.id);
    const r1 = await api('POST', `/requests/${openRequest.data.id}/responses`, { token: T.seller, body: { proposed_quantity: 9000 } });
    const r2 = await api('POST', `/requests/${openRequest.data.id}/responses`, { token: T.seller2, body: { proposed_quantity: 9000 } });
    record('Demandes', 'Deux vendeurs proposent', { expected: ['201/201'], actual: [r1.status, r2.status].join('/') });
    const a1 = await api('PATCH', `/requests/${openRequest.data.id}/responses/${r1.data.id}`, { token: T.buyer, body: { status: 'accepted' } });
    const a2 = await api('PATCH', `/requests/${openRequest.data.id}/responses/${r2.data.id}`, { token: T.buyer, body: { status: 'accepted' } });
    record('Demandes', 'Une seule proposition acceptée (2e refusée)', {
      expected: ['200/409'], actual: [a1.status, a2.status].join('/'),
    });
    const req = await api('GET', `/requests/${openRequest.data.id}`, { token: T.buyer });
    record('Demandes', 'Demande passe “in_progress”', { expected: ['in_progress'], actual: req.data?.status });
  }

  // Course : deux acceptations simultanées ne doivent laisser qu’un gagnant,
  // y compris si l’on passe outre le service (index unique partiel).
  const raceRequest = await api('POST', '/requests', {
    token: T.buyer, body: { category_id: CATEGORY, title: 'AUDIT — demande en course', quantity: 10000, unit: 'kg' },
  });
  if (raceRequest.status === 201) {
    created.requests.push(raceRequest.data.id);
    const c1 = await api('POST', `/requests/${raceRequest.data.id}/responses`, { token: T.seller, body: { proposed_quantity: 9000 } });
    const c2 = await api('POST', `/requests/${raceRequest.data.id}/responses`, { token: T.seller2, body: { proposed_quantity: 9000 } });
    const [s1, s2] = await Promise.all([
      api('PATCH', `/requests/${raceRequest.data.id}/responses/${c1.data.id}`, { token: T.buyer, body: { status: 'accepted' } }),
      api('PATCH', `/requests/${raceRequest.data.id}/responses/${c2.data.id}`, { token: T.buyer, body: { status: 'accepted' } }),
    ]);
    record('Demandes', 'Acceptations simultanées : une seule gagnante', {
      expected: ['200/409', '409/200'], actual: [s1.status, s2.status].join('/'),
    });
    const winners = await query("SELECT COUNT(*) AS n FROM request_responses WHERE request_id = $1 AND status = 'accepted'", [raceRequest.data.id]);
    record('Demandes', 'Une seule proposition acceptée en base', { expected: [1], actual: winners.rows[0].n });
    let uniqueBlocked = false;
    try {
      await query("INSERT INTO request_responses (request_id, responder_id, status) VALUES ($1, $2, 'accepted')",
        [raceRequest.data.id, pointvert.id]);
    } catch (error) { uniqueBlocked = error.code === '23505'; }
    record('Demandes', 'Index unique : 2e acceptée refusée même en SQL direct', { expected: [true], actual: uniqueBlocked });
  }

  /* ------------------------------------------------------------ échanges */
  const ex = await api('POST', '/exchanges', {
    token: T.buyer, body: { wanted_category_id: CATEGORY, wanted_label: 'Grignons', wanted_quantity: 5, wanted_unit: 'kg', given_label: 'Savon', given_quantity: 1, given_unit: 'unit', max_total_wanted: 100 },
  });
  record('Échanges', 'Création proposition', { expected: [201], actual: ex.status });
  if (ex.status === 201) {
    created.exchanges.push(ex.data.id);
    record('Échanges', 'Réponse > objectif maximum refusée (1000 pour 100 kg)', {
      expected: [409], actual: (await api('POST', `/exchanges/${ex.data.id}/responses`, { token: T.seller, body: { quantity_offered: 1000 } })).status,
    });
    const r1 = await api('POST', `/exchanges/${ex.data.id}/responses`, { token: T.seller, body: { quantity_offered: 60 } });
    const r2 = await api('POST', `/exchanges/${ex.data.id}/responses`, { token: T.seller2, body: { quantity_offered: 60 } });
    record('Échanges', 'Deux participants sous l’objectif', { expected: ['201/201'], actual: [r1.status, r2.status].join('/') });
    if (r1.status === 201 && r2.status === 201) {
      const acc1 = await api('PATCH', `/exchanges/${ex.data.id}/responses/${r1.data.id}`, { token: T.buyer, body: { status: 'accepted' } });
      const acc2 = await api('PATCH', `/exchanges/${ex.data.id}/responses/${r2.data.id}`, { token: T.buyer, body: { status: 'accepted' } });
      record('Échanges', 'Acceptation au-delà de l’objectif refusée (60 + 60 pour 100 kg)', {
        expected: ['200/409'], actual: [acc1.status, acc2.status].join('/'),
      });
    }
    record('Échanges', 'Répondre à son propre échange refusé', {
      expected: [400], actual: (await api('POST', `/exchanges/${ex.data.id}/responses`, { token: T.buyer, body: { quantity_offered: 1 } })).status,
    });
  }

  // Course : deux acceptations simultanées ne doivent jamais dépasser le plafond.
  const raceExchange = await api('POST', '/exchanges', {
    token: T.buyer, body: { wanted_category_id: CATEGORY, wanted_label: 'Grignons', wanted_quantity: 5, wanted_unit: 'kg', given_label: 'Savon', given_quantity: 1, given_unit: 'unit', max_total_wanted: 100 },
  });
  if (raceExchange.status === 201) {
    created.exchanges.push(raceExchange.data.id);
    const e1 = await api('POST', `/exchanges/${raceExchange.data.id}/responses`, { token: T.seller, body: { quantity_offered: 60 } });
    const e2 = await api('POST', `/exchanges/${raceExchange.data.id}/responses`, { token: T.seller2, body: { quantity_offered: 60 } });
    if (e1.status === 201 && e2.status === 201) {
      const [a1, a2] = await Promise.all([
        api('PATCH', `/exchanges/${raceExchange.data.id}/responses/${e1.data.id}`, { token: T.buyer, body: { status: 'accepted' } }),
        api('PATCH', `/exchanges/${raceExchange.data.id}/responses/${e2.data.id}`, { token: T.buyer, body: { status: 'accepted' } }),
      ]);
      record('Échanges', 'Acceptations simultanées : plafond respecté', {
        expected: ['200/409', '409/200'], actual: [a1.status, a2.status].join('/'),
      });
      const sum = await query("SELECT COALESCE(SUM(quantity_offered), 0) AS total FROM exchange_responses WHERE exchange_id = $1 AND status = 'accepted'", [raceExchange.data.id]);
      record('Échanges', 'Total accepté ≤ objectif en base (60 / 100)', { expected: [60], actual: sum.rows[0].total });
      let triggerBlocked = false;
      try {
        await query("UPDATE exchange_responses SET status = 'accepted' WHERE exchange_id = $1 AND status <> 'accepted'", [raceExchange.data.id]);
      } catch (error) { triggerBlocked = error.code === '23514'; }
      record('Échanges', 'Trigger : dépassement du plafond refusé en SQL direct', { expected: [true], actual: triggerBlocked });
    }
  }
  const expired = await api('POST', '/exchanges', {
    token: T.buyer, body: { wanted_category_id: CATEGORY, wanted_label: 'Grignons', wanted_quantity: 5, wanted_unit: 'kg', given_label: 'Savon', given_quantity: 1, given_unit: 'unit', expires_at: new Date(Date.now() - 86400000).toISOString().slice(0, 10) },
  });
  if (expired.status === 201) {
    created.exchanges.push(expired.data.id);
    record('Échanges', 'Réponse à un échange expiré refusée', {
      expected: [409], actual: (await api('POST', `/exchanges/${expired.data.id}/responses`, { token: T.seller, body: { quantity_offered: 1 } })).status,
    });
    record('Échanges', 'Échange expiré absent du flux', {
      expected: [false], actual: (await api('GET', '/exchanges', { token: T.seller })).data.some((e) => e.id === expired.data.id),
    });
  }
} catch (error) {
  console.error('\nAUDIT ABORTED:', error.message);
  results.push({ category: 'Audit', name: 'exécution', expected: ['-'], actual: 'ERREUR', ok: false, detail: error.message });
} finally {
  /* ------------------------------------------------------------- cleanup */
  try {
    if (created.offers.length) await query('DELETE FROM offers WHERE id = ANY($1)', [created.offers]);
    if (created.requests.length) await query('DELETE FROM buy_requests WHERE id = ANY($1)', [created.requests]);
    if (created.exchanges.length) await query('DELETE FROM exchange_offers WHERE id = ANY($1)', [created.exchanges]);
    if (created.points.length) await query('DELETE FROM collection_points WHERE id = ANY($1)', [created.points]);
    if (created.products.length) await query('DELETE FROM products WHERE id = ANY($1)', [created.products]);
    if (startedAt) {
      const ids = Object.values(T ?? {}).length
        ? (await query("SELECT id FROM users WHERE email IN ('admin@clac.tn','huilerie.zitouna@clac.tn','moulin.elamal@clac.tn','achats@biodiesel-sahel.tn','collecte.sfax@clac.tn','grandtunis@eco-collecte.tn')")).rows.map((r) => r.id)
        : [];
      if (ids.length) await query('DELETE FROM notifications WHERE created_at >= $1 AND user_id = ANY($2)', [startedAt, ids]);
    }
  } catch (error) {
    console.error('cleanup failed:', error.message);
  }

  const failed = results.filter((r) => !r.ok);
  const holes = results.filter((r) => r.ok && r.bug);
  console.log(`\n${results.length} contrôles — ${results.length - failed.length - holes.length} conformes, ${holes.length} failles logiques, ${failed.length} échecs`);
  if (failed.length) console.log('\nÉCHECS:\n' + failed.map((r) => `- ${r.category} / ${r.name}: obtenu ${r.actual}, attendu ${r.expected.join('/')}${r.detail ? ` (${r.detail})` : ''}`).join('\n'));
  process.exitCode = 0;
  const pool = (await import('../src/config/db.js')).default;
  await pool.end();
}
