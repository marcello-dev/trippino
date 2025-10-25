echo "Archiving..."
git archive --format=tar --prefix=trippino/ HEAD | gzip > /tmp/trippino.tar.gz
echo "Deploying..."
scp /tmp/trippino.tar.gz  trippino@api-as.apivenue.com:/tmp
ssh trippino@api-as.apivenue.com "sudo rm -r /opt/trippino"
ssh trippino@api-as.apivenue.com "sudo tar -xzf /tmp/trippino.tar.gz -C /opt"
ssh trippino@api-as.apivenue.com "sudo chown -R trippino:trippino /opt/trippino"
ssh trippino@api-as.apivenue.com "sed -i 's/http:\/\/localhost:4000/https:\/\/trippino-api.apivenue.com/g' /opt/trippino/frontend/index.html"
ssh trippino@api-as.apivenue.com "npm --prefix /opt/trippino install --omit=dev"
echo "Restarting services..."
ssh trippino@api-as.apivenue.com "sudo systemctl restart trippino-api"
ssh trippino@api-as.apivenue.com "sudo systemctl restart trippino-frontend"
echo "Deployment complete"