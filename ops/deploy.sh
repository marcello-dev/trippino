cd /workspaces
#tar --exclude-from=trippino/.gitignore -czf /tmp/trippino.tar.gz trippino
git archive --format=tar --prefix=trippino/ HEAD | gzip > /tmp/trippino.tar.gz
scp -i /tmp/trippino.tar.gz  trippino@api-as.apivenue.com:/opt/trippino
# ssh into vm as "trippino"
sudo rm -r /opt/trippino
sudo tar -xzf /tmp/trippino.tar.gz -C /opt
chown -R trippino:trippino /opt/trippino
