#!/bin/bash
cd /opt/football-bot/webapp
source venv/bin/activate
pip install gunicorn
gunicorn -w 2 -b 0.0.0.0:5000 wsgi:app \
  --access-logfile /var/log/football-bot/webapp-access.log \
  --error-logfile /var/log/football-bot/webapp-error.log \
  --daemon
