-- Enable logical replication for Debezium
ALTER SYSTEM SET wal_level = logical;
ALTER SYSTEM SET max_replication_slots = 4;
ALTER SYSTEM SET max_wal_senders = 4;

-- Create application schema
CREATE SCHEMA IF NOT EXISTS app_data;

-- Sample tables for testing
CREATE TABLE app_data.users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE app_data.orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES app_data.users(id),
    product_name VARCHAR(100),
    quantity INTEGER,
    price NUMERIC(10, 2),
    status VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert sample data
INSERT INTO app_data.users (username, email) VALUES
    ('alice', 'alice@example.com'),
    ('bob', 'bob@example.com');

INSERT INTO app_data.orders (user_id, product_name, quantity, price, status) VALUES
    (1, 'Widget A', 5, 29.99, 'pending'),
    (2, 'Widget B', 3, 49.99, 'shipped');

-- Grant replication privileges for Debezium
-- Note: This runs as the default postgres user, then we alter the app user
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pipeline_user') THEN
        ALTER USER pipeline_user WITH REPLICATION;
    END IF;
END
$$;
