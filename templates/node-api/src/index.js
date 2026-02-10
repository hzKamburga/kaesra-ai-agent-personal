import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "{{PROJECT_NAME}}",
    timestamp: new Date().toISOString()
  });
});

app.post("/echo", (req, res) => {
  res.json({
    youSent: req.body
  });
});

app.listen(port, () => {
  console.log(`{{PROJECT_NAME}} listening on port ${port}`);
});
