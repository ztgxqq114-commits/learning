/*
 * 立德學習平台 設定檔
 * ------------------------------------------------------------
 * 維護者通常只需要改這個檔案。改完後在 GitHub 上 Commit，
 * 約 1 分鐘後網站就會更新。
 */
window.LIDE_CONFIG = {
  // 課程資料來源（Google 試算表「發布到網路」後的 CSV 網址）
  // 留空 "" 時，會讀取 site/data/ 資料夾裡的示範資料。
  unitsCsvUrl: "",
  quizzesCsvUrl: "",

  // 測驗紀錄（選填）：學員送出測驗後，把成績記到 Google 表單。
  // 設定方式見 docs/07-測驗紀錄設定.md；留空就不記錄。
  quizLog: {
    formResponseUrl: "", // 例："https://docs.google.com/forms/d/e/XXXX/formResponse"
    fields: {
      name: "",  // 例："entry.111111"
      unit: "",  // 例："entry.222222"
      score: "", // 例："entry.333333"
      total: ""  // 例："entry.444444"
    }
  },

  // 三大主軸：名稱必須和試算表「主軸」欄位完全一致
  tracks: ["搞順自己", "挺好隊友", "發揮影響力"]
};
