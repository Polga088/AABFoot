const path = require("path");

const root = __dirname;
const dbPath = path.join(root, "football.db");

module.exports = {
  apps: [
    {
      name: "football-bot",
      script: "src/index.js",
      cwd: root,
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        DB_PATH: dbPath
      }
    },
    {
      name: "football-webapp",
      script: "venv/bin/gunicorn",
      args: "-w 2 -b 127.0.0.1:5000 wsgi:app",
      cwd: path.join(root, "webapp"),
      interpreter: "none"
    }
  ]
};
