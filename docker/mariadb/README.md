# MariaDB Galera Cluster Management Guide

This guide provides detailed instructions for setting up, configuring, and managing a MariaDB Galera Cluster with HAProxy for load balancing.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Cluster Management](#cluster-management)
4. [Monitoring and Maintenance](#monitoring-and-maintenance)
5. [Backup and Recovery](#backup-and-recovery)
6. [Security](#security)
7. [Performance Tuning](#performance-tuning)
8. [Troubleshooting](#troubleshooting)
9. [Advanced Configuration](#advanced-configuration)
10. [References](#references)

## Prerequisites

Before setting up the MariaDB Galera Cluster, ensure you have the following:

- Docker Engine (20.10.0 or later)
- Docker Compose (v2.0.0 or later)
- At least 8GB RAM available
- Sufficient disk space (at least 10GB recommended)
- Network ports available: 3306 (MySQL), 8404 (HAProxy stats), 4567-4568 and 4444 (Galera)

## Installation

### Getting Started

1. Review and adjust the configuration in `compose.yml` and `haproxy.cfg` if needed.

2. Make the bootstrap script executable:

```bash
chmod +x bootstrap.sh
```

3. Start the cluster:

```bash
./bootstrap.sh start
```

The script will:
- Initialize the first MariaDB node with Galera configuration
- Start additional nodes to join the cluster
- Configure HAProxy as a load balancer
- Verify the cluster is functioning correctly

### Verifying Installation

To verify the cluster is running correctly:

```bash
./bootstrap.sh status
```

Connect to the database through HAProxy:

```bash
mysql -h 127.0.0.1 -P 3306 -u root -ppass123
```

Once connected, you can check the Galera cluster status:

```sql
SHOW STATUS LIKE 'wsrep_%';
```

## Cluster Management

### Starting and Stopping the Cluster

- To start the cluster:
  ```bash
  ./bootstrap.sh start
  ```

- To stop the cluster:
  ```bash
  ./bootstrap.sh stop
  ```

- To restart the cluster:
  ```bash
  ./bootstrap.sh restart
  ```

### Adding a New Node

To add a new node to the cluster:

```bash
./bootstrap.sh add-node mariadb4
```

This will:
1. Add the node configuration to docker-compose.yml
2. Update HAProxy configuration to include the new node
3. Start the new node and connect it to the cluster

### Removing a Node

To remove a node from the cluster:

```bash
./bootstrap.sh remove-node mariadb4
```

### Repairing the Cluster

If the cluster becomes inconsistent (split-brain scenario or after a crash):

```bash
./bootstrap.sh repair
```

For advanced recovery using the most advanced node:

```bash
./bootstrap.sh repair --with-most-advanced-node
```

## Monitoring and Maintenance

### Checking Cluster Status

Check the status of all nodes:

```bash
./bootstrap.sh status
```

### HAProxy Monitoring

View HAProxy statistics:

```bash
./bootstrap.sh haproxy-status
```

Or access the web interface at http://localhost:8404/

### Network Diagnostics

To diagnose network connectivity issues between nodes:

```bash
./bootstrap.sh diagnose-network
```

### Performance Diagnostics

To check for performance issues:

```bash
./bootstrap.sh diagnose-performance
```

## Backup and Recovery

### Creating Backups

For a full backup:

```bash
./bootstrap.sh backup full
```

For an incremental backup (binary logs):

```bash
./bootstrap.sh backup incremental
```

Backups are stored in the `./backups` directory.

### Restoring from Backup

To restore the cluster from a backup:

```bash
./bootstrap.sh restore ./backups/galera_full_20250517_120000.sql
```

## Security

### Changing Passwords

To change the root password:

```bash
./bootstrap.sh change-password new_secure_password
```

### Enabling SSL/TLS

To secure communication with SSL/TLS:

```bash
./bootstrap.sh enable-ssl --generate-certs
```

This will:
1. Generate SSL certificates and keys
2. Configure MariaDB to use SSL
3. Update HAProxy to handle SSL connections
4. Require SSL for all connections

After enabling SSL, restart the cluster:

```bash
./bootstrap.sh restart
```

## Performance Tuning

### Applying Custom Configuration

To apply custom configuration files:

```bash
./bootstrap.sh apply-config --mariadb-config=my-custom.cnf --haproxy-config=my-haproxy.cfg
```

### Key Performance Settings

The default configuration includes optimized settings for:

- InnoDB buffer pool: 3GB
- Query cache: 512MB
- Connection limits: 10,000 max connections
- InnoDB I/O optimizations
- Galera replication performance

To adjust these settings, create a custom configuration file and apply it as shown above.

## Troubleshooting

### Common Issues and Solutions

#### Node Won't Join Cluster

1. Check network connectivity:
   ```bash
   ./bootstrap.sh diagnose-network
   ```

2. Verify the node's status:
   ```bash
   docker compose logs mariadb2
   ```

3. Check for SST issues (State Snapshot Transfer):
   ```bash
   docker compose exec mariadb1 cat /var/lib/mysql/error.log | grep SST
   ```

#### Split-Brain Scenario

If some nodes become disconnected and form separate clusters:

1. Identify the most advanced node:
   ```bash
   ./bootstrap.sh repair --with-most-advanced-node
   ```

#### HAProxy Issues

1. Check HAProxy status:
   ```bash
   ./bootstrap.sh haproxy-status
   ```

2. Verify HAProxy configuration:
   ```bash
   docker compose exec haproxy haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg
   ```

## Advanced Configuration

### Multi-Region Deployment

For geographically distributed clusters:

1. Use WAN optimized settings in `wsrep_provider_options`:
  - gmcast.segment=0 for first region
  - gmcast.segment=1 for second region
  - Adjust evs.suspect_timeout and other timing parameters

2. Consider configuring asynchronous replication between regions with MariaDB's built-in replication.

### Large Datasets

For clusters with large databases:

1. Increase SST timeout values:
  - wsrep_sst_donor_timeout
  - wsrep_sst_recv_timeout

2. Optimize InnoDB settings:
  - innodb_buffer_pool_size (increase to 50-75% of available RAM)
  - innodb_log_file_size (set to 25% of buffer pool size)

## References

- [MariaDB Galera Cluster Documentation](https://mariadb.com/kb/en/galera-cluster/)
- [Galera Cluster Documentation](https://galeracluster.com/library/)
- [HAProxy Documentation](https://www.haproxy.org/#docs)
- [Docker Documentation](https://docs.docker.com/)
