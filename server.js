const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const serviceAccount = require("./firebase-credentials.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.post("/api/action", async (req, res) => {
  try {
    const { slotId, userId, displayName } = req.body;
    let result;

    const slotsRef = db.collection("slots");
    const rentalsRef = db.collection("rentals");

    const targetSlotRef = slotsRef.doc(slotId);
    const targetSlotDoc = await targetSlotRef.get();

    if (!targetSlotDoc.exists) {
      return res.status(404).send({ success: false, message: "存在しないスロットです。" });
    }
    const targetSlotData = targetSlotDoc.data();

    const currentRentalQuery = await rentalsRef.where("userId", "==", userId).limit(1).get();

    if (!currentRentalQuery.empty) { // 返却処理
      const currentRentalDoc = currentRentalQuery.docs[0];
      if (targetSlotData.status !== "Empty") {
        result = { success: false, message: "このスロットは空ではありません。空のスロットに返却してください。" };
      } else {
        await targetSlotRef.update({ status: "Available", umbrellaId: currentRentalDoc.data().umbrellaId });
        await currentRentalDoc.ref.delete();
        db.collection("logs").add({ action: "返却", slotId: slotId, umbrellaId: currentRentalDoc.data().umbrellaId, userId, displayName, timestamp: new Date() });
        result = { success: true, message: `${targetSlotData.standName}の${targetSlotData.slotId.split('-')[2]}番に傘(${currentRentalDoc.data().umbrellaId})を返却しました。` };
      }
    } else { // 貸出処理
      const alreadyBorrowedQuery = await rentalsRef.where("userId", "==", userId).limit(1).get();
      if (!alreadyBorrowedQuery.empty) {
        result = { success: false, message: "すでに他の傘を借りています。同時に2本以上は借りられません。" };
      } else if (targetSlotData.status !== "Available") {
        result = { success: false, message: "このスロットに利用可能な傘はありません。" };
      } else {
        const umbrellaIdToBorrow = targetSlotData.umbrellaId;
        await rentalsRef.add({ userId, displayName, umbrellaId: umbrellaIdToBorrow, borrowedFrom: slotId, timestamp: new Date() });
        await targetSlotRef.update({ status: "Empty", umbrellaId: null });
        db.collection("logs").add({ action: "貸出", slotId: slotId, umbrellaId: umbrellaIdToBorrow, userId, displayName, timestamp: new Date() });
        result = { success: true, message: `${targetSlotData.standName}の${targetSlotData.slotId.split('-')[2]}番から傘(${umbrellaIdToBorrow})を借りました！` };
      }
    }
    res.status(200).send(result);

  } catch (error) {
    console.error("Error:", error);
    res.status(500).send({ success: false, message: "サーバーでエラーが発生しました。" });
  }
});

app.get("/api/logs", async (req, res) => {
    const snapshot = await db.collection("logs").orderBy("timestamp", "desc").get();
    const logs = snapshot.docs.map(doc => ({...doc.data(), timestamp: doc.data().timestamp.toDate()}));
    res.json(logs);
});

app.get("/api/status", async (req, res) => {
    const slotsSnapshot = await db.collection("slots").orderBy("slotId").get();
    const slots = slotsSnapshot.docs.map(doc => doc.data());
    res.json({ slots }); // status.htmlで使いやすいように変更
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート${PORT}で起動しました。`);
});
