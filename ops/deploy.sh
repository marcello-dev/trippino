#cd /workspaces
#tar --exclude-from=trippino/.gitignore -czf /tmp/trippino.tar.gz trippino
git archive --format=tar --prefix=trippino/ HEAD | gzip > /tmp/trippino.tar.gz
scp /tmp/trippino.tar.gz  trippino@api-as.apivenue.com:/opt/trippino
# ssh into vm as "trippino"
sudo rm -r /opt/trippino
sudo tar -xzf /tmp/trippino.tar.gz -C /opt
sudo chown -R trippino:trippino /opt/trippino
sed -i 's/http:\/\/localhost:4000/https:\/\/trippino-api.apivenue.com/g' /opt/trippino/frontend/index.html
sudo systemctl restart trippino-api
sudo systemctl restart trippino-frontend