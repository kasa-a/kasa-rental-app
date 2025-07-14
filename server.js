const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;

const app = express();
const DB_PATH = "./db.json";

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// LIFFアプリからのリクエストを処理するメインのAPI
app.post("/api/action", async (req, res) => {
  try {
    const dbData = JSON.parse(await fs.readFile(DB_PATH));
    const { slotId, userId, displayName } = req.body;
    let result;

    // スキャンされたスロットを探す
    let targetSlot = null;
    for (const stand of dbData.stands) {
      const foundSlot = stand.slots.find((s) => s.slotId === slotId);
      if (foundSlot) {
        targetSlot = foundSlot;
        break;
      }
    }

    if (!targetSlot) {
      return res.status(404).send({ success: false, message: "存在しないスロットです。" });
    }

    // ユーザーが既に何かを借りているか確認
    const currentRental = dbData.rentals.find((r) => r.userId === userId);

    // 返却処理
    if (currentRental) {
      if (targetSlot.status !== "Empty") {
        result = { success: false, message: "このスロットは空ではありません。空のスロットに返却してください。" };
      } else {
        // スロットの状態を更新
        targetSlot.status = "Available";
        targetSlot.umbrellaId = currentRental.umbrellaId;
        // rentalsからユーザーの貸出記録を削除
        dbData.rentals = dbData.rentals.filter((r) => r.userId !== userId);
        // ログを記録
        dbData.logs.push({ action: "返却", slotId: slotId, umbrellaId: currentRental.umbrellaId, userId, displayName, timestamp: new Date().toISOString() });
        result = { success: true, message: `${slotId} に傘(${currentRental.umbrellaId})を返却しました。` };
      }
    } 
    // 貸出処理
    else {
      if (targetSlot.status !== "Available") {
        result = { success: false, message: "このスロットに利用可能な傘はありません。" };
      } else {
        const umbrellaIdToBorrow = targetSlot.umbrellaId;
        // 貸出記録を作成
        dbData.rentals.push({ userId, displayName, umbrellaId: umbrellaIdToBorrow, borrowedFrom: slotId, timestamp: new Date().toISOString() });
        // スロットの状態を更新
        targetSlot.status = "Empty";
        targetSlot.umbrellaId = null;
        // ログを記録
        dbData.logs.push({ action: "貸出", slotId: slotId, umbrellaId: umbrellaIdToBorrow, userId, displayName, timestamp: new Date().toISOString() });
        result = { success: true, message: `${slotId} から傘(${umbrellaIdToBorrow})を借りました！` };
      }
    }

    await fs.writeFile(DB_PATH, JSON.stringify(dbData, null, 2));
    res.status(200).send(result);

  } catch (error) {
    console.error("Error:", error);
    res.status(500).send({ success: false, message: "サーバーでエラーが発生しました。" });
  }
});

// 管理者向けAPI（変更なし）
app.get("/api/logs", async (req, res) => {
    const dbData = JSON.parse(await fs.readFile(DB_PATH));
    res.json(dbData.logs.slice().reverse());
});
app.get("/api/status", async (req, res) => {
    const dbData = JSON.parse(await fs.readFile(DB_PATH));
    res.json({ stands: dbData.stands, borrowedUsers: dbData.rentals });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート${PORT}で起動しました。`);
});
