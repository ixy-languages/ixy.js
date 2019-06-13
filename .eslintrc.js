module.exports = {
  extends: ["eslint:recommended", "airbnb"],
  rules: {
    indent: ["warn", 2],
    quotes: [
      "error",
      "single",
      {
        allowTemplateLiterals: false,
        avoidEscape: true
      }
    ],
    camelcase: "warn",
    "no-bitwise": "off",
    "no-plusplus": "off", // temporarily, i DO want to ge this through
    "no-param-reassign": "off" // let's see if i can change this afterwards
  },
  parserOptions: {
    parser: "babel-eslint"
  }
};
