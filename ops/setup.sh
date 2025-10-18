# As root
adduser trippino
echo "trippino  ALL=(ALL) NOPASSWD:ALL" | tee /etc/sudoers.d/trippino
mkdir /home/trippino/.ssh
chmod 700 /home/trippino/.ssh
touch /home/trippino/.ssh/authorized_keys
chmod 600 /home/trippino/.ssh/authorized_keys
echo "ssh-rsa PUBKEY" >> /home/trippino/.ssh/authorized_keys
chown -R trippino:trippino /home/trippino/.ssh

mkdir /opt/trippino
chown -R trippino:trippino /opt/trippino

dnf install nodejs
npm install -g http-server

# As trippino
cd /opt/trippino
npm install --production

# As root
cat << EOL > /etc/systemd/system/trippino-api.service
[Unit]
Description=trippino-api
After=syslog.target

[Service]
User=trippino
ExecStart=node /opt/trippino/backend/index.js
SuccessExitStatus=143
q
[Install]
WantedBy=multi-user.target
EOL
systemctl daemon-reload
systemctl enable trippino-api


cat << EOL > /etc/systemd/system/trippino-frontend.service
[Unit]
Description=trippino-frontend
After=syslog.target

[Service]
User=trippino
ExecStart=npx http-server /opt/trippino/frontend -p 5000
SuccessExitStatus=143

[Install]
WantedBy=multi-user.target
EOL
systemctl daemon-reload
systemctl enable trippino-frontend
