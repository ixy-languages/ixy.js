# ixy.js
this will be the javascript implementation of [ixy](https://github.com/emmericp/ixy)

I'm currently trying to get to the first working version, nothing to see here yet.

# starting the current code on our testbed

Let's use the testbed narva as an example, though you can use any if you change the PCI Adress in the code beforehand.


## move data from our directory to narva

```scp -r mountFromMac narva:/root/```

## install needed dependencies

```apt install sudo
sudo apt-get update
curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
sudo apt-get install -y nodejs

cd mountFromMac
sudo ./setup-hugetlbfs.sh```

we might need `npm i` here

## build the program

will run it as well:
```npm run start```

or

```npm i --unsafe-perm```

## run program after building

```nodejs testapp.js```
