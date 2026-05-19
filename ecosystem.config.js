module.exports = {
  apps: [
    {
      name: "football-bot",
      script: "src/index.js",
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
      env: { NODE_ENV: "production" }
    },
    {
      name: "football-webapp",
      script: "webapp/venv/bin/gunicorn",
      args: "-w 2 -b 0.0.0.0:5000 wsgi:app",
      cwd: "/opt/football-bot/webapp",
      interpreter: "none"
    }
  ]
};
