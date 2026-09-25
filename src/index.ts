import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`OTOVOICE listening on http://localhost:${config.port}`);
  console.log(`Engine: ${config.provider}`);
});
