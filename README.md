# ixy.js
This is the JavaScript implementation of [ixy](https://github.com/emmericp/ixy)


## install needed dependencies
TODO update this, use nvm
`
apt install sudo
sudo apt-get update
curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
sudo apt-get install -y nodejs


## build the program

```npm run setup```

If you want to work on the project, remember to also install dev dependencies via `npm i`

They provide formatting etc. rules

## run program after building

to run the generate example:

```node ixy.js generate xxxx:xx:xx.x optionalBatchSize```


to run the forward example:

```node ixy.js forward xxxx:xx:xx.x xxxx:xx:xx.x optionalBatchSize```

The pci adresses should have the format `xxxx:xx:xx.x` and could look like this: `0000:03:00.0`
