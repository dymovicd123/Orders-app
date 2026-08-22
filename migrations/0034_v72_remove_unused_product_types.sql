-- Step 125: remove the unused "product types" directory.
-- Product names live in catalog_products; adult/child type lives on catalog variants/order items.
-- No application table references reference_values(kind = 'product_type').
DELETE FROM reference_values WHERE kind = 'product_type';
