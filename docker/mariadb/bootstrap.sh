#!/bin/bash
set -e

# Create initial Galera Cluster bootstrap script

# Description:
# This script helps with the first-time initialization of a Galera cluster
# and performs health checks on the cluster nodes.

# Usage:
# chmod +x bootstrap.sh
# ./bootstrap.sh [start|status|repair]

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-pass123}

function print_header() {
    echo -e "\n${YELLOW}=== $1 ===${NC}\n"
}

function check_status() {
    local node=$1
    print_header "Checking status of $node"

    echo "Checking if node is running..."
    docker compose exec $node mysqladmin -u root -p${MYSQL_ROOT_PASSWORD} ping || return 1

    echo "Checking Galera cluster status..."
    docker compose exec $node mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "SHOW STATUS LIKE 'wsrep_%';" || return 1

    # Check if node is part of the cluster and synced
    local wsrep_cluster_size=$(docker compose exec $node mysql -u root -p${MYSQL_ROOT_PASSWORD} -N -e "SHOW STATUS LIKE 'wsrep_cluster_size';" | awk '{print $2}')
    local wsrep_local_state=$(docker compose exec $node mysql -u root -p${MYSQL_ROOT_PASSWORD} -N -e "SHOW STATUS LIKE 'wsrep_local_state_comment';" | awk '{print $2}')

    echo -e "Cluster size: ${GREEN}$wsrep_cluster_size${NC}"
    echo -e "Local state: ${GREEN}$wsrep_local_state${NC}"

    if [[ "$wsrep_cluster_size" -lt 3 ]]; then
        echo -e "${RED}Warning: Cluster size is less than expected (3 nodes)${NC}"
        return 2
    fi

    if [[ "$wsrep_local_state" != "Synced" ]]; then
        echo -e "${RED}Warning: Node is not synced${NC}"
        return 2
    fi

    return 0
}

function start_cluster() {
    print_header "Starting Galera Cluster"

    # Check if mariadb1 is running
    if ! docker compose ps mariadb1 | grep -q "Up"; then
        echo "Starting first node with GALERA_NEW_CLUSTER=1"
        GALERA_NEW_CLUSTER=1 docker compose up -d mariadb1
        sleep 30  # Wait for the first node to be ready
    else
        echo "First node is already running"
    fi

    # Start other nodes
    echo "Starting remaining nodes"
    docker compose up -d mariadb2 mariadb3 haproxy

    # Wait for nodes to be ready
    echo "Waiting for all nodes to be ready..."
    sleep 30

    # Create haproxy check user on all nodes
    print_header "Creating HAProxy check user"
    docker compose exec mariadb1 mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "
        CREATE USER IF NOT EXISTS 'haproxy_check'@'%';
        FLUSH PRIVILEGES;
    "

    # Check cluster status
    check_status mariadb1
    check_status mariadb2
    check_status mariadb3

    print_header "Cluster Information"
    echo -e "${GREEN}MariaDB Galera Cluster is running${NC}"
    echo "Access the cluster via HAProxy at localhost:3306"
    echo "HAProxy stats page: http://localhost:8404/"
    echo -e "Credentials: root / ${MYSQL_ROOT_PASSWORD}"
}

function repair_cluster() {
    print_header "Repairing Galera Cluster"

    # Stop all nodes
    echo "Stopping all nodes..."
    docker compose stop mariadb1 mariadb2 mariadb3

    # Start first node with new cluster flag
    echo "Starting first node with new cluster flag..."
    GALERA_NEW_CLUSTER=1 docker compose up -d mariadb1
    sleep 30  # Wait for the first node to initialize

    # Start other nodes
    echo "Starting remaining nodes..."
    docker compose up -d mariadb2 mariadb3
    sleep 30

    # Start HAProxy
    echo "Starting HAProxy..."
    docker compose up -d haproxy

    # Check cluster status
    check_status mariadb1
    check_status mariadb2
    check_status mariadb3
}

case "$1" in
    start)
        start_cluster
        ;;
    status)
        check_status mariadb1
        check_status mariadb2
        check_status mariadb3
        ;;
    repair)
        repair_cluster
        ;;
    *)
        echo "Usage: $0 [start|status|repair]"
        exit 1
        ;;
esac

exit 0
