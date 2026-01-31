// PM2 Configuration for MoltChirp
module.exports = {
  apps: [{
    name: 'moltchirp',
    script: 'src/index.js',
    instances: 'max',        // Use all CPU cores
    exec_mode: 'cluster',    // Cluster mode for load balancing
    
    // Environment
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // Restart policy
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '500M',
    
    // Logs
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Watch (disable in production)
    watch: false,
    ignore_watch: ['node_modules', 'logs', '*.db'],
    
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
};
