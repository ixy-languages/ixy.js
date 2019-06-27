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
    "no-param-reassign": "off", // let's see if i can change this afterwards
    "no-restricted-syntax": [
      // because we want to loop with for in/of because of performance. we assume all of the vars we loop through are arrays, and not objects. This is a very important assumption.
      "off",
      {
        selector: "ForInStatement",
        message:
          "for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array."
      },
      {
        selector: "ForOfStatement",
        message:
          "iterators/generators require regenerator-runtime, which is too heavyweight for this guide to allow them. Separately, loops should be avoided in favor of array iterations."
      }
    ]
  },
  parserOptions: {
    parser: "babel-eslint"
  },
  globals: {
    BigInt: true,
    BigUint64Array: true
  }
};
