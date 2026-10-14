# Test fixtures

- `vizio/`: answers of a real VIZIO TV (VHD24M-0810, firmware 3.720.9.1-1) captured by
  [vizaio](https://github.com/raman325/vizaio) (MIT, Copyright (c) 2026 Raman Gupta), anonymized:
  serial number, advertising identifiers and the error-reporting key were replaced or removed.
- `tls/`: a self-signed certificate and its key, made for the tests only (the fake TV of
  `test/https.test.js`). They protect nothing.
- `gladys-feature-table.json`: the category/type couples the Gladys core knows.
