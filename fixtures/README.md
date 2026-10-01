# Generated synthetic receipts

`npm start` signs and writes R17.json, R18.json and R19.json for the current local deployment. Use these files for drag-and-drop import. The UI's **Import synthetic receipt** action loads the same signed payload.

These files contain commitment hashes and signatures, never private evidence or private keys. Old receipts may be invalid after a local chain restart; use the newly generated files.
