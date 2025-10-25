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

mkdir /var/lib/trippino
chown -R trippino:trippino /var/lib/trippino

mkdir /etc/trippino
chown -R trippino:trippino /etc/trippino


cat << EOL > /etc/systemd/system/trippino.service
[Unit]
Description=trippino
After=syslog.target

[Service]
User=trippino
ExecStart=node /opt/trippino/app/app.js
EnvironmentFile=/etc/trippino/trippino.conf

[Install]
WantedBy=multi-user.target
EOL

systemctl daemon-reload
systemctl enable trippino

# Now deploy app and start the service


