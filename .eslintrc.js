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
    "no-bitwise": "off"
  },
  parserOptions: {
    parser: "babel-eslint"
  }
};
