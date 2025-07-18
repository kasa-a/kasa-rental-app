const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// 秘密鍵を使ってFirebaseを初期化
const serviceAccount = require("./firebase-credentials.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Firestoreの設定を変更し、リトライを有効にする
db.settings({
  retry: true,
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// メインの処理を行うAPIエンドポイント
app.post("/api/action", async (req, res) => {
  try {
    const { slotId, userId, displayName } = req.body;
    let result;

    const slotsRef = db.collection("slots");
    const rentalsRef = db.collection("rentals");
    const logsRef = db.collection("logs");

    const targetSlotRef = slotsRef.doc(slotId);
    
    const currentRentalQuery = await rentalsRef.where("userId", "==", userId).limit(1).get();

    // 返却処理
    if (!currentRentalQuery.empty) {
      const currentRentalDoc = currentRentalQuery.docs[0];
      const targetSlotDoc = await targetSlotRef.get();

      if (!targetSlotDoc.exists) {
        return res.status(404).send({ success: false, message: "返却しようとしているスロットが存在しません。" });
      }
      if (targetSlotDoc.data().status !== "Empty") {
        return res.status(400).send({ success: false, message: "このスロットは空ではありません。空のスロットに返却してください。" });
      }
      
      const umbrellaToReturn = currentRentalDoc.data();

      await db.runTransaction(async (transaction) => {
        // ▼▼▼ "利用可能"に修正 ▼▼▼
        transaction.update(targetSlotRef, { status: "利用可能", umbrellaId: umbrellaToReturn.umbrellaId });
        transaction.delete(currentRentalDoc.ref);
      });

      await logsRef.add({ action: "返却", slotId, umbrellaId: umbrellaToReturn.umbrellaId, userId, displayName, timestamp: new Date() });
      result = { success: true, message: `${targetSlotDoc.data().standName}に傘(${umbrellaToReturn.umbrellaId})を返却しました。` };
    
    } 
    // 貸出処理
    else {
      const targetSlotDoc = await targetSlotRef.get();
      if (!targetSlotDoc.exists) {
        return res.status(404).send({ success: false, message: "貸出そうとしているスロットが存在しません。" });
      }
      const targetSlotData = targetSlotDoc.data();
      
      const alreadyBorrowedQuery = await rentalsRef.where("userId", "==", userId).limit(1).get();
      if (!alreadyBorrowedQuery.empty) {
          return res.status(400).send({ success: false, message: "すでに他の傘を借りています。同時に2本以上は借りられません。" });
      } 
      // ▼▼▼ "利用可能"に修正 ▼▼▼
      else if (targetSlotData.status !== "利用可能") {
        return res.status(400).send({ success: false, message: "このスロットに利用可能な傘はありません。" });
      }

      const umbrellaIdToBorrow = targetSlotData.umbrellaId;

      await db.runTransaction(async (transaction) => {
        transaction.update(targetSlotRef, { status: "Empty", umbrellaId: null });
        transaction.create(rentalsRef.doc(), { userId, displayName, umbrellaId: umbrellaIdToBorrow, borrowedFrom: slotId, timestamp: new Date() });
      });

      await logsRef.add({ action: "貸出", slotId, umbrellaId: umbrellaIdToBorrow, userId, displayName, timestamp: new Date() });
      result = { success: true, message: `${targetSlotData.standName}から傘(${umbrellaIdToBorrow})を借りました！` };
    }
    
    res.status(200).send(result);

  } catch (error) {
    console.error("★★★ サーバーでキャッチしたエラー:", error);
    res.status(500).send({ success: false, message: "サーバー内部でエラーが発生しました。" });
  }
});

// (管理者向けAPIは変更ありません)
app.get("/api/logs", async (req, res) => {
    const snapshot = await db.collection("logs").orderBy("timestamp", "desc").get();
    const logs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {...data, timestamp: data.timestamp.toDate()};
    });
    res.json(logs);
});

app.get("/api/status", async (req, res) => {
    const slotsSnapshot = await db.collection("slots").orderBy("slotId").get();
    const slots = slotsSnapshot.docs.map(doc => doc.data());
    res.json({ slots });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート${PORT}で起動しました。`);
});
