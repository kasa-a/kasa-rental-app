const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// ★秘密鍵を使ってFirebaseを初期化
const serviceAccount = require("./firebase-credentials.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// メインの処理を行うAPIエンドポイント
app.post("/api/action", async (req, res) => {
  try {
    const { slotId, userId, displayName } = req.body;
    let result;

    const rentalsRef = db.collection("rentals");
    
    // スキャンされたスロットの情報を取得
    const targetSlotDoc = await db.collectionGroup("slots").where("slotId", "==", slotId).get();
    if (targetSlotDoc.empty) {
        return res.status(404).send({ success: false, message: "存在しないスロットです。" });
    }
    const targetSlotRef = targetSlotDoc.docs[0].ref;
    const targetSlotData = targetSlotDoc.docs[0].data();
    const standDoc = await targetSlotRef.parent.parent.get();
    const standName = standDoc.data().name;

    // ユーザーが既に何かを借りているか確認
    const currentRentalQuery = await rentalsRef.where("userId", "==", userId).limit(1).get();
    
    // 返却処理
    if (!currentRentalQuery.empty) {
      const currentRentalDoc = currentRentalQuery.docs[0];
      if (targetSlotData.status !== "Empty") {
        result = { success: false, message: "このスロットは空ではありません。空のスロットに返却してください。" };
      } else {
        await targetSlotRef.update({ status: "Available", umbrellaId: currentRentalDoc.data().umbrellaId });
        await currentRentalDoc.ref.delete();
        db.collection("logs").add({ action: "返却", slotId: slotId, umbrellaId: currentRentalDoc.data().umbrellaId, userId, displayName, timestamp: new Date() });
        result = { success: true, message: `${standName}の${slotId.split('-')[2]}番に傘(${currentRentalDoc.data().umbrellaId})を返却しました。` };
      }
    } 
    // 貸出処理
    else {
      if (targetSlotData.status !== "Available") {
        result = { success: false, message: "このスロットに利用可能な傘はありません。" };
      } else {
        const umbrellaIdToBorrow = targetSlotData.umbrellaId;
        await rentalsRef.add({ userId, displayName, umbrellaId: umbrellaIdToBorrow, borrowedFrom: slotId, timestamp: new Date() });
        await targetSlotRef.update({ status: "Empty", umbrellaId: null });
        db.collection("logs").add({ action: "貸出", slotId: slotId, umbrellaId: umbrellaIdToBorrow, userId, displayName, timestamp: new Date() });
        result = { success: true, message: `${standName}の${slotId.split('-')[2]}番から傘(${umbrellaIdToBorrow})を借りました！` };
      }
    }
    res.status(200).send(result);

  } catch (error) {
    console.error("Error:", error);
    res.status(500).send({ success: false, message: "サーバーでエラーが発生しました。" });
  }
});

// 管理者向けAPI
app.get("/api/logs", async (req, res) => {
    const snapshot = await db.collection("logs").orderBy("timestamp", "desc").get();
    const logs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {...data, timestamp: data.timestamp.toDate()}; // TimestampオブジェクトをDateオブジェクトに変換
    });
    res.json(logs);
});

app.get("/api/status", async (req, res) => {
    const standsSnapshot = await db.collection("stands").get();
    const standsData = [];
    for(const standDoc of standsSnapshot.docs) {
        const stand = {id: standDoc.id, ...standDoc.data(), slots: []};
        const slotsSnapshot = await standDoc.ref.collection("slots").orderBy("slotId").get();
        stand.slots = slotsSnapshot.docs.map(slotDoc => slotDoc.data());
        standsData.push(stand);
    }

    const rentalsSnapshot = await db.collection("rentals").get();
    const borrowedUsers = rentalsSnapshot.docs.map(doc => doc.data());

    res.json({ stands: standsData, borrowedUsers });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート${PORT}で起動しました。`);
});
