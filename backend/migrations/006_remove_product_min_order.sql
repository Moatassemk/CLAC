-- La commande minimum est retirée du parcours vendeur : les annonces déjà
-- publiées redeviennent commandables à toute quantité. La colonne reste en
-- base pour ne pas casser les intégrations qui l'envoient encore.
UPDATE products SET min_order_quantity = NULL;
