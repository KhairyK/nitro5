const stats = {
  totalRequests: 0,
  totalErrors: 0,
  activeConnections: 0
};

export function incRequest() {
  stats.totalRequests++;
}

export function incError() {
  stats.totalErrors++;
}

export function incConn() {
  stats.activeConnections++;
}

export function decConn() {
  stats.activeConnections--;
}

export function getStats() {
  return stats;
}