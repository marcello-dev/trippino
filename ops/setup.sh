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

# As trippino user
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 22
node -v 
npm -v

npm install -g http-server

cd /opt/trippino
npm install --production