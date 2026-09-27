# As root
adduser trippino
echo "trippino  ALL=(ALL) NOPASSWD:ALL" | tee /etc/sudoers.d/trippino
mkdir /home/trippino/.ssh
chmod 700 /home/trippino/.ssh
touch /home/trippino/.ssh/authorized_keys
chmod 600 /home/trippino/.ssh/authorized_keys
echo "ssh-rsa PUBKEY" >> /home/trippino/.ssh/authorized_keys


mkdir /opt/trippino
chown -R trippino:trippino /opt/trippino

apt install nodejs
apt install npm
npm install -g http-server
apt install sqlite3
apt install python3-pip -y

mkdir /etc/trippino
chown -R trippino:trippino /etc/trippino

# for db
mkdir /var/lib/trippino
chown -R trippino:trippino /var/lib/trippino


cat << EOL > /etc/systemd/system/trippino.service
[Unit]
Description=trippino
After=syslog.target

[Service]
User=trippino
ExecStart=node /opt/trippino/app/app.js
EnvironmentFile=/etc/trippino/trippino.conf
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOL

systemctl daemon-reload
systemctl enable trippino

# Now deploy app and start the service


