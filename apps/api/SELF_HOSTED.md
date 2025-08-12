# 🏠 Self-Hosting Guide for Sync Store API

> Complete guide to deploy and manage your own Sync Store API instance

## 📋 Table of Contents

- [Requirements](#-requirements)
- [Installation Methods](#-installation-methods)
  - [Docker Deployment](#docker-deployment)
  - [Manual Installation](#manual-installation)
  - [Cloud Deployments](#cloud-deployments)
- [Configuration](#-configuration)
- [Database Setup](#-database-setup)
- [Security Hardening](#-security-hardening)
- [Monitoring & Maintenance](#-monitoring--maintenance)
- [Scaling & Performance](#-scaling--performance)
- [Backup & Recovery](#-backup--recovery)
- [Troubleshooting](#-troubleshooting)

## 🎯 Requirements

### Minimum System Requirements

- **CPU**: 2 cores (4 cores recommended)
- **RAM**: 2GB minimum (4GB recommended)
- **Storage**: 10GB for application + database growth
- **OS**: Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+) or macOS
- **Network**: Static IP or domain with SSL certificate

### Software Dependencies

- **Node.js**: >= 23.11.0
- **pnpm**: >= 10.14.0
- **Database**: MariaDB 10.6+ or MySQL 8.0+
- **Redis**: 6.0+ (optional, for caching)
- **Nginx/Caddy**: For reverse proxy (production)
- **PM2**: For process management (production)

## 🚀 Installation Methods

### Docker Deployment

#### 1. Using Docker Compose (Recommended)

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  api:
    image: sync-store-api:latest
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: mysql://sync:password@db:3306/syncstore
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      API_KEY_TOKEN_PREFIX: ${API_KEY_TOKEN_PREFIX}
    depends_on:
      - db
      - redis
    volumes:
      - ./logs:/app/logs
      - ./uploads:/app/uploads
    restart: unless-stopped
    networks:
      - sync-network

  db:
    image: mariadb:10.11
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: syncstore
      MYSQL_USER: sync
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - db-data:/var/lib/mysql
      - ./docker/mariadb/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "3306:3306"
    restart: unless-stopped
    networks:
      - sync-network

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"
    restart: unless-stopped
    networks:
      - sync-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
      - ./nginx/logs:/var/log/nginx
    depends_on:
      - api
    restart: unless-stopped
    networks:
      - sync-network

volumes:
  db-data:
  redis-data:

networks:
  sync-network:
    driver: bridge
```

Create `.env` file:

```env
# Security
JWT_SECRET=your-very-long-random-string-min-32-chars
API_KEY_TOKEN_PREFIX=sk_live_
DB_ROOT_PASSWORD=super-secure-root-password
DB_PASSWORD=secure-database-password
REDIS_PASSWORD=secure-redis-password

# Configuration
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://yourdomain.com
```

Deploy:

```bash
# Build and start services
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop services
docker-compose down
```

#### 2. Kubernetes Deployment

Create `k8s-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sync-store-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: sync-store-api
  template:
    metadata:
      labels:
        app: sync-store-api
    spec:
      containers:
      - name: api
        image: sync-store-api:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: sync-secrets
              key: database-url
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: sync-secrets
              key: jwt-secret
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: sync-store-api
spec:
  selector:
    app: sync-store-api
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
  type: LoadBalancer
```

Deploy to Kubernetes:

```bash
# Create namespace
kubectl create namespace sync-store

# Create secrets
kubectl create secret generic sync-secrets \
  --from-literal=database-url='mysql://user:pass@host/db' \
  --from-literal=jwt-secret='your-secret' \
  -n sync-store

# Apply deployment
kubectl apply -f k8s-deployment.yaml -n sync-store

# Check status
kubectl get pods -n sync-store
kubectl get svc -n sync-store
```

### Manual Installation

#### 1. System Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y build-essential git curl nginx certbot python3-certbot-nginx

# Install Node.js 23.x
curl -fsSL https://deb.nodesource.com/setup_23.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
npm install -g pnpm

# Install PM2
npm install -g pm2
```

#### 2. Database Setup

```bash
# Install MariaDB
sudo apt install -y mariadb-server mariadb-client

# Secure installation
sudo mysql_secure_installation

# Create database and user
sudo mysql -u root -p <<EOF
CREATE DATABASE syncstore;
CREATE USER 'syncuser'@'localhost' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON syncstore.* TO 'syncuser'@'localhost';
FLUSH PRIVILEGES;
EOF
```

#### 3. Redis Setup (Optional)

```bash
# Install Redis
sudo apt install -y redis-server

# Configure Redis
sudo nano /etc/redis/redis.conf
# Set: requirepass your-redis-password
# Set: maxmemory 256mb
# Set: maxmemory-policy allkeys-lru

# Restart Redis
sudo systemctl restart redis-server
sudo systemctl enable redis-server
```

#### 4. Application Setup

```bash
# Clone repository
git clone https://github.com/yourusername/sync-store.git
cd sync-store

# Install dependencies
pnpm install

# Configure environment
cd apps/api
cp .env.example .env.production
nano .env.production  # Edit with your configuration

# Build application
NODE_ENV=production pnpm build

# Run database migrations
pnpm db:migrate

# Seed initial data (optional)
pnpm db:seed
```

#### 5. PM2 Configuration

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'sync-store-api',
    script: './dist/main.js',
    cwd: '/opt/sync-store/apps/api',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    max_memory_restart: '1G',
    max_restarts: 10,
    min_uptime: '10s',
    watch: false,
    autorestart: true,
    cron_restart: '0 0 * * *'
  }]
};
```

Start with PM2:

```bash
# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save
pm2 startup

# Monitor
pm2 monit
```

#### 6. Nginx Configuration

Create `/etc/nginx/sites-available/sync-store`:

```nginx
upstream sync_store_api {
    least_conn;
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    keepalive 64;
}

server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Logging
    access_log /var/log/nginx/sync-store-access.log;
    error_log /var/log/nginx/sync-store-error.log;

    # WebSocket Support
    location /socket.io/ {
        proxy_pass http://sync_store_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }

    # API Endpoints
    location / {
        proxy_pass http://sync_store_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
        
        # Limits
        client_max_body_size 10M;
    }

    # Health check endpoint (no logging)
    location /health {
        access_log off;
        proxy_pass http://sync_store_api;
    }
}
```

Enable and test:

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/sync-store /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Get SSL certificate
sudo certbot --nginx -d api.yourdomain.com
```

### Cloud Deployments

#### AWS Deployment

1. **Using AWS Elastic Beanstalk**:

```bash
# Install EB CLI
pip install awsebcli

# Initialize EB
eb init -p node.js-20 sync-store-api

# Create environment
eb create production --instance-type t3.medium

# Deploy
eb deploy

# Set environment variables
eb setenv NODE_ENV=production DATABASE_URL=your-rds-url
```

2. **Using AWS ECS with Fargate**:

```bash
# Build and push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin [your-ecr-uri]
docker build -t sync-store-api .
docker tag sync-store-api:latest [your-ecr-uri]/sync-store-api:latest
docker push [your-ecr-uri]/sync-store-api:latest

# Create task definition and service via AWS Console or CLI
```

#### Google Cloud Platform

```bash
# Using Cloud Run
gcloud run deploy sync-store-api \
  --image gcr.io/[PROJECT-ID]/sync-store-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production
```

#### Azure Container Instances

```bash
# Create container instance
az container create \
  --resource-group sync-store-rg \
  --name sync-store-api \
  --image youracr.azurecr.io/sync-store-api:latest \
  --cpu 2 \
  --memory 4 \
  --ports 3000 \
  --environment-variables NODE_ENV=production
```

## 🔧 Configuration

### Environment Variables Reference

Create `.env.production`:

```env
# === Server Configuration ===
NODE_ENV=production
PORT=3000
API_URL=https://api.yourdomain.com
CLUSTER_MODE=true
WORKER_THREADS=4

# === Database Configuration ===
DATABASE_URL="mysql://user:password@localhost:3306/syncstore?ssl=true"
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=syncuser
DB_PASSWORD=your-secure-password
DB_DATABASE=syncstore
DB_CONNECTION_LIMIT=20
DB_SSL=true
DB_TIMEZONE=UTC

# === Redis Configuration (Optional) ===
REDIS_URL="redis://:password@localhost:6379/0"
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0
REDIS_KEY_PREFIX=sync:
REDIS_TTL=86400

# === Authentication ===
JWT_SECRET=your-very-long-random-string-minimum-32-characters
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=another-very-long-random-string
JWT_REFRESH_EXPIRES_IN=30d
JWT_ALGORITHM=HS256

# === API Keys ===
API_KEYS_ENABLED=true
API_KEY_TOKEN_PREFIX=sk_live_
API_KEY_DEFAULT_SCOPES=["read","write"]
API_KEY_DEFAULT_ENVIRONMENT=production
API_KEY_EXPIRATION_DAYS=365
API_KEY_HASH_ALGORITHM=sha256

# === Security ===
BCRYPT_SALT_ROUNDS=12
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
CSRF_SECRET=your-csrf-secret
CORS_ORIGIN=https://app.yourdomain.com,https://yourdomain.com
CORS_CREDENTIALS=true
HELMET_ENABLED=true
TRUST_PROXY=true

# === Session Management ===
SESSION_SECRET=your-session-secret
SESSION_MAX_AGE=86400000
SESSION_NAME=sync.sid
SESSION_SECURE=true
SESSION_HTTP_ONLY=true
SESSION_SAME_SITE=strict

# === Monitoring & Logging ===
LOG_LEVEL=info
LOG_FORMAT=json
LOG_DIRECTORY=./logs
LOG_MAX_FILES=14d
LOG_MAX_SIZE=20m
ENABLE_ACCESS_LOGS=true
ENABLE_ERROR_LOGS=true

# === Analytics ===
ENABLE_ANALYTICS=true
ANALYTICS_BATCH_SIZE=100
ANALYTICS_FLUSH_INTERVAL=60000
ANALYTICS_RETENTION_DAYS=90

# === Storage Limits ===
MAX_ITEM_SIZE_KB=100
MAX_STORAGE_PER_USER_MB=100
MAX_ITEMS_PER_USER=10000
TTL_CLEANUP_INTERVAL_HOURS=24
SOFT_DELETE_RETENTION_DAYS=30

# === Performance ===
ENABLE_COMPRESSION=true
COMPRESSION_LEVEL=6
ENABLE_CACHE=true
CACHE_TTL_SECONDS=300
CONNECTION_TIMEOUT_MS=30000
REQUEST_TIMEOUT_MS=60000

# === Email (Optional) ===
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
EMAIL_FROM="Sync Store <noreply@yourdomain.com>"

# === External Services (Optional) ===
SENTRY_DSN=https://xxx@sentry.io/xxx
OPENTELEMETRY_ENDPOINT=http://localhost:4318
PROMETHEUS_PORT=9090
GRAFANA_URL=http://localhost:3001

# === Feature Flags ===
ENABLE_WEBSOCKET=true
ENABLE_REST_API=true
ENABLE_CONFLICT_RESOLUTION=true
ENABLE_DATA_ENCRYPTION=false
ENABLE_DATA_COMPRESSION=true
ENABLE_AUDIT_LOG=true
ENABLE_BACKUP=true
```

### Advanced Configuration

#### 1. Database Connection Pooling

Configure in `prisma.config.ts`:

```typescript
export const databaseConfig = {
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  pool: {
    min: 2,
    max: 20,
    idleTimeoutMillis: 30000,
    createTimeoutMillis: 30000,
    acquireTimeoutMillis: 30000,
    propagateCreateError: false,
  },
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'info', 'warn', 'error']
    : ['error'],
};
```

#### 2. Redis Configuration

Create `redis.conf`:

```conf
# Performance
maxmemory 512mb
maxmemory-policy allkeys-lru
tcp-keepalive 60
timeout 300

# Persistence
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec

# Security
requirepass your-redis-password
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
```

## 🗄️ Database Setup

### Initial Setup

```sql
-- Create database
CREATE DATABASE IF NOT EXISTS syncstore 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

-- Create user
CREATE USER IF NOT EXISTS 'syncuser'@'%' 
  IDENTIFIED BY 'your-secure-password';

-- Grant privileges
GRANT ALL PRIVILEGES ON syncstore.* TO 'syncuser'@'%';
FLUSH PRIVILEGES;

-- Performance optimizations
SET GLOBAL max_connections = 200;
SET GLOBAL innodb_buffer_pool_size = 1073741824; -- 1GB
SET GLOBAL innodb_log_file_size = 268435456; -- 256MB
SET GLOBAL query_cache_size = 67108864; -- 64MB
SET GLOBAL query_cache_type = 1;
```

### Run Migrations

```bash
cd apps/api

# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Verify schema
pnpm db:view
```

### Database Maintenance

Create `maintenance.sql`:

```sql
-- Optimize tables (run weekly)
OPTIMIZE TABLE SyncStorageItem;
OPTIMIZE TABLE ApiKey;
OPTIMIZE TABLE SyncSession;
OPTIMIZE TABLE SyncAnalytics;

-- Clean up old sessions (run daily)
DELETE FROM SyncSession 
WHERE disconnectedAt < DATE_SUB(NOW(), INTERVAL 7 DAY);

-- Archive old data (run monthly)
INSERT INTO SyncArchive 
SELECT * FROM SyncStorageItem 
WHERE lastModified < DATE_SUB(NOW(), INTERVAL 90 DAY);

DELETE FROM SyncStorageItem 
WHERE lastModified < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- Update statistics
ANALYZE TABLE SyncStorageItem;
ANALYZE TABLE ApiKey;
```

## 🔒 Security Hardening

### 1. Firewall Configuration

```bash
# Install UFW
sudo apt install -y ufw

# Configure firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp  # Only if needed for direct access
sudo ufw enable
```

### 2. Fail2ban Configuration

```bash
# Install fail2ban
sudo apt install -y fail2ban

# Create jail configuration
sudo nano /etc/fail2ban/jail.local
```

Add configuration:

```ini
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sync-store-api]
enabled = true
port = 80,443
filter = sync-store-api
logpath = /var/log/nginx/sync-store-access.log
maxretry = 10

[nginx-limit-req]
enabled = true
```

### 3. SSL/TLS Configuration

```bash
# Generate strong DH parameters
sudo openssl dhparam -out /etc/ssl/certs/dhparam.pem 4096

# Update Nginx SSL configuration
sudo nano /etc/nginx/snippets/ssl-params.conf
```

Add SSL parameters:

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers on;
ssl_dhparam /etc/ssl/certs/dhparam.pem;
ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384;
ssl_ecdh_curve secp384r1;
ssl_session_timeout 10m;
ssl_session_cache shared:SSL:10m;
ssl_session_tickets off;
ssl_stapling on;
ssl_stapling_verify on;
```

### 4. API Key Security

```javascript
// Generate secure API keys
const crypto = require('crypto');

function generateApiKey() {
  const prefix = 'sk_live_';
  const randomBytes = crypto.randomBytes(32);
  const hash = crypto.createHash('sha256').update(randomBytes).digest('hex');
  return prefix + hash;
}

console.log(generateApiKey());
```

### 5. Environment Security

```bash
# Secure .env file
chmod 600 .env.production
chown www-data:www-data .env.production

# Create secure directory structure
mkdir -p /opt/sync-store/{logs,uploads,backups}
chmod 750 /opt/sync-store/*
chown -R www-data:www-data /opt/sync-store
```

## 📊 Monitoring & Maintenance

### 1. Health Monitoring

Create `health-check.sh`:

```bash
#!/bin/bash

API_URL="https://api.yourdomain.com"
SLACK_WEBHOOK="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

# Check API health
response=$(curl -s -o /dev/null -w "%{http_code}" $API_URL/health)

if [ $response -ne 200 ]; then
  curl -X POST $SLACK_WEBHOOK \
    -H 'Content-Type: application/json' \
    -d '{"text":"⚠️ Sync Store API is down! HTTP Status: '$response'"}'
fi

# Check database
mysql -u syncuser -p$DB_PASSWORD -e "SELECT 1" > /dev/null 2>&1
if [ $? -ne 0 ]; then
  curl -X POST $SLACK_WEBHOOK \
    -H 'Content-Type: application/json' \
    -d '{"text":"⚠️ Database connection failed!"}'
fi
```

Add to crontab:

```bash
# Run health check every 5 minutes
*/5 * * * * /opt/sync-store/scripts/health-check.sh
```

### 2. Log Management

Configure logrotate `/etc/logrotate.d/sync-store`:

```
/opt/sync-store/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 640 www-data www-data
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### 3. Prometheus Monitoring

Add to `app.module.ts`:

```typescript
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    PrometheusModule.register({
      port: 9090,
      path: '/metrics',
    }),
  ],
})
```

Prometheus configuration `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'sync-store-api'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: '/metrics'
```

### 4. Grafana Dashboard

Import dashboard JSON for visualization:

```json
{
  "dashboard": {
    "title": "Sync Store API Metrics",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])"
          }
        ]
      },
      {
        "title": "Response Time",
        "targets": [
          {
            "expr": "http_request_duration_ms"
          }
        ]
      },
      {
        "title": "Active Connections",
        "targets": [
          {
            "expr": "websocket_connections_active"
          }
        ]
      }
    ]
  }
}
```

## ⚡ Scaling & Performance

### Horizontal Scaling

#### 1. Load Balancer Configuration

Using HAProxy (`haproxy.cfg`):

```
global
    maxconn 4096
    log /dev/log local0
    log /dev/log local1 notice

defaults
    mode http
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms
    option httplog

frontend http_front
    bind *:80
    bind *:443 ssl crt /etc/ssl/certs/cert.pem
    redirect scheme https if !{ ssl_fc }
    default_backend http_back

backend http_back
    balance roundrobin
    option httpclose
    option forwardfor
    server api1 127.0.0.1:3001 check
    server api2 127.0.0.1:3002 check
    server api3 127.0.0.1:3003 check
```

#### 2. Database Replication

Configure MariaDB master-slave:

```sql
-- On master
CREATE USER 'replication'@'%' IDENTIFIED BY 'password';
GRANT REPLICATION SLAVE ON *.* TO 'replication'@'%';
FLUSH PRIVILEGES;
SHOW MASTER STATUS;

-- On slave
CHANGE MASTER TO
  MASTER_HOST='master-ip',
  MASTER_USER='replication',
  MASTER_PASSWORD='password',
  MASTER_LOG_FILE='mysql-bin.000001',
  MASTER_LOG_POS=0;
START SLAVE;
```

#### 3. Redis Clustering

```bash
# Create Redis cluster
redis-cli --cluster create \
  127.0.0.1:7000 127.0.0.1:7001 \
  127.0.0.1:7002 127.0.0.1:7003 \
  127.0.0.1:7004 127.0.0.1:7005 \
  --cluster-replicas 1
```

### Performance Optimization

#### 1. Node.js Optimization

```javascript
// PM2 ecosystem for clustering
module.exports = {
  apps: [{
    name: 'sync-store-api',
    script: './dist/main.js',
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=4096'
    }
  }]
};
```

#### 2. Database Optimization

```sql
-- Create indexes
CREATE INDEX idx_user_key ON SyncStorageItem(userId, key);
CREATE INDEX idx_timestamp ON SyncStorageItem(timestamp);
CREATE INDEX idx_instance ON SyncStorageItem(instanceId);

-- Partition large tables
ALTER TABLE SyncStorageItem
PARTITION BY RANGE (YEAR(lastModified)) (
  PARTITION p2023 VALUES LESS THAN (2024),
  PARTITION p2024 VALUES LESS THAN (2025),
  PARTITION p2025 VALUES LESS THAN (2026)
);
```

## 💾 Backup & Recovery

### Automated Backup Script

Create `backup.sh`:

```bash
#!/bin/bash

BACKUP_DIR="/opt/sync-store/backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="syncstore"
DB_USER="syncuser"
DB_PASS="your-password"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
mysqldump -u $DB_USER -p$DB_PASS $DB_NAME | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Backup application files
tar -czf $BACKUP_DIR/app_$DATE.tar.gz /opt/sync-store/apps/api

# Backup environment files
cp /opt/sync-store/apps/api/.env.production $BACKUP_DIR/env_$DATE

# Upload to S3 (optional)
aws s3 cp $BACKUP_DIR/db_$DATE.sql.gz s3://your-bucket/backups/
aws s3 cp $BACKUP_DIR/app_$DATE.tar.gz s3://your-bucket/backups/

# Clean old backups (keep 30 days)
find $BACKUP_DIR -type f -mtime +30 -delete

# Log
echo "Backup completed: $DATE" >> $BACKUP_DIR/backup.log
```

Add to crontab:

```bash
# Daily backup at 2 AM
0 2 * * * /opt/sync-store/scripts/backup.sh
```

### Restore Procedure

```bash
# Stop application
pm2 stop sync-store-api

# Restore database
gunzip < backup.sql.gz | mysql -u syncuser -p syncstore

# Restore application files
tar -xzf app_backup.tar.gz -C /

# Restore environment
cp env_backup /opt/sync-store/apps/api/.env.production

# Restart application
pm2 start sync-store-api
```

## 🔧 Troubleshooting

### Common Issues

#### 1. Connection Refused

```bash
# Check if service is running
pm2 status
systemctl status nginx
systemctl status mysql

# Check ports
netstat -tlnp | grep 3000
```

#### 2. Database Connection Error

```bash
# Test connection
mysql -u syncuser -p -h localhost syncstore

# Check credentials
grep DATABASE_URL .env.production

# Check MySQL logs
tail -f /var/log/mysql/error.log
```

#### 3. WebSocket Connection Failed

```bash
# Check Nginx configuration
nginx -t

# Verify WebSocket headers
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: xxx" \
  https://api.yourdomain.com/socket.io/
```

#### 4. High Memory Usage

```bash
# Check memory usage
pm2 monit

# Restart with memory limit
pm2 delete sync-store-api
pm2 start ecosystem.config.js --max-memory-restart 1G

# Check for memory leaks
node --inspect dist/main.js
```

#### 5. Slow Performance

```bash
# Check database queries
mysql -u root -p -e "SHOW PROCESSLIST;"

# Analyze slow queries
mysqldumpslow -s t /var/log/mysql/slow-query.log

# Check Redis
redis-cli INFO stats

# Monitor API response times
curl -w "@curl-format.txt" -o /dev/null -s https://api.yourdomain.com/health
```

### Debug Mode

Enable debug logging:

```env
LOG_LEVEL=debug
DEBUG=*
```

View logs:

```bash
# PM2 logs
pm2 logs sync-store-api --lines 100

# Application logs
tail -f /opt/sync-store/logs/app.log

# Nginx logs
tail -f /var/log/nginx/sync-store-error.log
```

### Performance Profiling

```javascript
// Add to main.ts for profiling
if (process.env.ENABLE_PROFILING === 'true') {
  const v8Profiler = require('v8-profiler-next');
  const fs = require('fs');
  
  v8Profiler.startProfiling('CPU profile');
  setTimeout(() => {
    const profile = v8Profiler.stopProfiling();
    profile.export((error, result) => {
      fs.writeFileSync('profile.cpuprofile', result);
      profile.delete();
    });
  }, 60000);
}
```

## 📚 Additional Resources

- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Socket.io Documentation](https://socket.io/docs)
- [PM2 Documentation](https://pm2.keymetrics.io/docs)
- [Nginx Documentation](https://nginx.org/en/docs)
- [MariaDB Documentation](https://mariadb.com/kb/en)

## 🆘 Support

For issues and questions:
- GitHub Issues: [https://github.com/yourusername/sync-store/issues](https://github.com/yourusername/sync-store/issues)
- Email: ali_4286@live.com
- Documentation: [https://sync-store.usestrict.dev](https://sync-store.usestrict.dev)

---

Last updated: 2024