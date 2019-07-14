# ixy.js
The JavaScript implementation of [ixy](https://github.com/ixy-languages/ixy-languages). It features a state-of-the-art user-space network driver written in idiomatic JavaScript running on Node.js.


This should **not** be used in production environments or private, non-expendable machines as we cannot guarantee that this does not break other PCIe devices and their drivers if used incorrectly.


## install node
Make sure you have sudo:
`apt install sudo`
`sudo apt-get update`

Install nvm via 
```curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash```

Then close and reopen your terminal to start using nvm or run the following to use it instantly:
`export NVM_DIR="$HOME/.nvm"`
`[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm`
`[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion`


After that you can install and choose a node version by simply typing
```nvm install 10```
and
```nvm use 10```



## build the program

```npm run setup```


If you want to work on the project, remember to also install dev dependencies via `npm i` or simply use ```npm run devsetup``` instead.

They provide formatting rules and other IDE functionalities.

## run program after building

to run the generate example:

```npm run generate xxxx:xx:xx.x optionalBatchSize```


to run the forward example: (remember, you need to send packets to those ports for forwarding to do something. (Moongen)[https://github.com/ixy-languages/benchmark-scripts] can handle that.)

```npm run forward xxxx:xx:xx.x xxxx:xx:xx.x optionalBatchSize```

The pci adresses should have the format `xxxx:xx:xx.x` and could look like this: `0000:03:00.0`


If you add `true` after defining a batch size the program will also calculate an average speed for performance testing.
