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
    
    // ▼▼▼ デバッグ用ログを追加 ▼▼▼
    console.log("===== APIリクエスト受信 =====");
    console.log("スキャンされたスロットID:", slotId);
    console.log("ユーザーID:", userId);
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

    const rentalsRef = db.collection("rentals");
    
    const targetSlotDoc = await db.collectionGroup("slots").where("slotId", "==", slotId).get();
    if (targetSlotDoc.empty) {
        console.log("エラー: Firestoreでスロットが見つかりませんでした。");
        return res.status(404).send({ success: false, message: "存在しないスロットです。" });
    }
    const targetSlotRef = targetSlotDoc.docs[0].ref;
    const targetSlotData = targetSlotDoc.docs[0].data();

    // ▼▼▼ デバッグ用ログを追加 ▼▼▼
    console.log("データベースから取得したスロット情報:", targetSlotData);
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

    const currentRentalQuery = await rentalsRef.where("userId", "==", userId).limit(1).get();
    
    if (!currentRentalQuery.empty) { // 返却処理
      // (返却ロジックは変更なし)
      const currentRentalDoc = currentRentalQuery.docs[0];
      if (targetSlotData.status !== "Empty") {
        result = { success: false, message: "このスロットは空ではありません。空のスロットに返却してください。" };
      } else {
        await targetSlotRef.update({ status: "Available", umbrellaId: currentRentalDoc.data().umbrellaId });
        await currentRentalDoc.ref.delete();
        db.collection("logs").add({ action: "返却", slotId: slotId, umbrellaId: currentRentalDoc.data().umbrellaId, userId, displayName, timestamp: new Date() });
        result = { success: true, message: `傘(${currentRentalDoc.data().umbrellaId})を返却しました。` };
      }
    } 
    else { // 貸出処理
      // ▼▼▼ デバッグ用ログを追加 ▼▼▼
      console.log("貸出処理を開始します。");
      // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
      
      if (targetSlotData.status !== "Available") {
        // ▼▼▼ デバッグ用ログを追加 ▼▼▼
        console.log(`貸出失敗: スロットのステータスが 'Available' ではありませんでした。実際のステータス: ${targetSlotData.status}`);
        // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
        result = { success: false, message: "このスロットに利用可能な傘はありません。" };
      } else {
        const umbrellaIdToBorrow = targetSlotData.umbrellaId;
        await rentalsRef.add({ userId, displayName, umbrellaId: umbrellaIdToBorrow, borrowedFrom: slotId, timestamp: new Date() });
        await targetSlotRef.update({ status: "Empty", umbrellaId: null });
        db.collection("logs").add({ action: "貸出", slotId: slotId, umbrellaId: umbrellaIdToBorrow, userId, displayName, timestamp: new Date() });
        result = { success: true, message: `傘(${umbrellaIdToBorrow})を借りました！` };
      }
    }
    res.status(200).send(result);

  } catch (error) {
    console.error("★★★ サーバーでキャッチしたエラー:", error);
    res.status(500).send({ success: false, message: "サーバーでエラーが発生しました。" });
  }
});

// (管理者向けAPIは変更ありません)
app.get("/api/logs", async (req, res) => {
    const snapshot = await db.collection("logs").orderBy("timestamp", "desc").get();
    const logs = snapshot.docs.map(doc => ({...doc.data(), timestamp: doc.data().timestamp.toDate()}));
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
