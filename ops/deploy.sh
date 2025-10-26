echo "Archiving..."
git archive --format=tar --prefix=trippino/ HEAD | gzip > /tmp/trippino.tar.gz
echo "Deploying..."
scp /tmp/trippino.tar.gz  trippino@apivenue.com:/tmp
ssh trippino@apivenue.com "sudo rm -r /opt/trippino"
ssh trippino@apivenue.com "sudo tar -xzf /tmp/trippino.tar.gz -C /opt"
ssh trippino@apivenue.com "sudo chown -R trippino:trippino /opt/trippino"
ssh trippino@apivenue.com "npm --prefix /opt/trippino install --omit=dev"
echo "Restarting services..."
ssh trippino@apivenue.com "sudo systemctl restart trippino"
echo "Deployment complete"