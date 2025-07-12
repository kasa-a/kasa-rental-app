// 必要な部品を読み込む
const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;

const app = express();
const DB_PATH = "./db.json";

// アプリの設定
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// メインの処理を行うAPIエンドポイント
app.post("/api/action", async (req, res) => {
  try {
    const dbData = JSON.parse(await fs.readFile(DB_PATH));
    const { action, umbrellaId, userId, displayName } = req.body;
    let result;

    const umbrella = dbData.umbrellas.find((u) => u.id === umbrellaId);

    switch (action) {
      // (checkStatusは変更ありません)
      case "checkStatus":
        if (!umbrella) {
          result = { status: "Not Found" };
        } else {
          result = {
            status: umbrella.status,
            lentToCurrentUser: umbrella.status === "貸出中" && umbrella.userId === userId,
          };
        }
        break;

      case "borrow":
        if (!umbrella) {
          result = { success: false, message: "指定された傘が見つかりません。" };
        } else if (umbrella.status === "貸出中") {
          result = { success: false, message: "この傘はすでに貸し出し中です。" };
        } else {
          // ▼▼▼ displayNameも保存するよう修正 ▼▼▼
          umbrella.status = "貸出中";
          umbrella.userId = userId;
          umbrella.displayName = displayName; 
          umbrella.lastUpdateTime = new Date().toISOString();
          dbData.logs.push({ action: "貸出", umbrellaId, userId, displayName, timestamp: new Date().toISOString() });
          result = { success: true, message: "傘を借りました！" };
        }
        break;

      case "return":
        if (!umbrella) {
          result = { success: false, message: "指定された傘が見つかりません。" };
        } else if (umbrella.status === "貸出中" && umbrella.userId !== userId) {
            result = { success: false, message: "あなたが借りている傘ではありません。" };
        } else {
          // ▼▼▼ displayNameもクリアするよう修正 ▼▼▼
          umbrella.status = "利用可能";
          umbrella.userId = "";
          umbrella.displayName = "";
          umbrella.lastUpdateTime = new Date().toISOString();
          dbData.logs.push({ action: "返却", umbrellaId, userId, displayName, timestamp: new Date().toISOString() });
          result = { success: true, message: "傘を返却しました！" };
        }
        break;
      default:
        result = { success: false, message: "無効なアクションです。" };
        break;
    }

    await fs.writeFile(DB_PATH, JSON.stringify(dbData, null, 2));
    res.status(200).send(result);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send({ success: false, message: "サーバーでエラーが発生しました。" });
  }
});

// (管理者向けAPIは変更ありません)
app.get("/api/logs", async (req, res) => {
  const dbData = JSON.parse(await fs.readFile(DB_PATH));
  res.json(dbData.logs.slice().reverse());
});
app.get("/api/status", async (req, res) => {
  const dbData = JSON.parse(await fs.readFile(DB_PATH));
  res.json(dbData.umbrellas);
});

// サーバーを起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバーがポート${PORT}で起動しました。`);
});
