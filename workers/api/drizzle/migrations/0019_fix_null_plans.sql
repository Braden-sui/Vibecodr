-- Fix any users with NULL plan by defaulting to 'free'
UPDATE users SET plan = 'free' WHERE plan IS NULL;
