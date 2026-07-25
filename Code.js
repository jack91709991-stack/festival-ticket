/**
 * 自治会お祭りチケット引換管理システム - Google Apps Script (GAS) APIスクリプト
 * 
 * 【導入手順】
 * 1. Googleスプレッドシートを新規作成します。
 * 2. スプレッドシートのメニューから「拡張機能」＞「Apps Script」を開きます。
 * 3. 元からあるコードを消去し、本スクリプト（Code.js）の内容を貼り付けます。
 * 4. エディタ右上にある「デプロイ」＞「新しいデプロイ」をクリックします。
 * 5. 種類の選択で「ウェブアプリ」を選択します。
 * 6. 設定を以下のように指定します:
 *    - 説明: 任意 (例: Ticket API v2)
 *    - 次のユーザーとして実行: 自分 (あなたのメールアドレス)
 *    - アクセスできるユーザー: 全員 (※全員にしないとアプリから通信できません)
 * 7. 「デプロイ」ボタンを押し、表示される「ウェブアプリのURL」をコピーして、アプリの設定画面に貼り付けます。
 * 
 * 【Googleフォーム連携と自動メール送信の設定手順】
 * 1. スプレッドシートのメニューから「挿入」＞「フォーム」で申し込みフォームを作成します。
 * 2. フォームの質問項目に以下を作成します（※質問の表記を完全一致させてください）:
 *    - 「氏名」（一行記述）
 *    - 「フリガナ」（一行記述）
 *    - 「班名」（例: 1-3班 の形式で入力するよう説明を記載）
 *    - 「電話番号」（ハイフンなし）
 *    - 「チケット枚数」（数値入力。スマートにするには回答の検証で「数字」＞「整数」＞「1以上」に制限）
 *    - 「メールアドレス」（メールアドレス収集の設定にするか、テキスト質問で「メールアドレス」を作成）
 *    - 「備考」（複数行記述、任意）
 * 3. GASエディタの左メニューから「トリガー」（目覚まし時計アイコン）をクリックします。
 * 4. 右下の「トリガーを追加」をクリックし、以下のように設定して保存します:
 *    - 実行する関数を選択: onFormSubmit
 *    - 実行するデプロイを選択: ヘッド (Head)
 *    - イベントのソースを選択: スプレッドシートから
 *    - イベントの種類を選択: フォーム送信時
 */

// 「引換マスター」シート名
var MASTER_SHEET_NAME = "引換マスター";

// マスターシートを取得（存在しない場合は自動作成してヘッダーを設定）
function getMasterSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MASTER_SHEET_NAME);
    // ヘッダー行を書き込み
    var headers = ["チケットID", "班名", "氏名", "フリガナ", "電話番号", "チケット枚数", "ステータス", "引換日時", "受付方法", "備考"];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
    // 初期状態で行を固定
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// GETリクエスト時の処理（データ読込）
function doGet(e) {
  var action = e.parameter.action;
  
  if (action === 'read') {
    return readDatabase();
  }
  
  return createJsonResponse({ error: 'Invalid GET action' });
}

// POSTリクエスト時の処理（引換更新・新規登録）
function doPost(e) {
  try {
    var postData = JSON.parse(e.postData.contents);
    var action = postData.action;
    
    if (action === 'exchange') {
      return exchangeTicket(postData.id, postData.exchange_time);
    } else if (action === 'register') {
      return registerTicket(postData.record);
    }
    
    return createJsonResponse({ error: 'Invalid POST action' });
  } catch (error) {
    return createJsonResponse({ error: error.toString() });
  }
}

// スプレッドシートから全データを取得
function readDatabase() {
  var sheet = getMasterSheet();
  var rows = sheet.getDataRange().getValues();
  
  var data = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[0]) continue; // 空行はスキップ
    
    data.push({
      id: row[0].toString(),
      ban: row[1].toString(),
      name: row[2].toString(),
      kana: row[3].toString(),
      phone: row[4].toString(),
      tickets: parseInt(row[5], 10) || 1,
      status: row[6].toString(),
      exchange_time: row[7] ? formatDate(row[7]) : '',
      method: row[8].toString(),
      notes: row[9].toString()
    });
  }
  
  return createJsonResponse(data);
}

// チケットIDを検索し、引換済みに更新（重複チェック付き）
function exchangeTicket(ticketId, exchangeTime) {
  var sheet = getMasterSheet();
  var lastRow = sheet.getLastRow();
  
  if (lastRow < 2) {
    return createJsonResponse({ success: false, reason: 'Empty database' });
  }
  
  var range = sheet.getRange(2, 1, lastRow - 1, 10); // A列からJ列まで取得
  var values = range.getValues();
  
  for (var i = 0; i < values.length; i++) {
    var currentId = values[i][0].toString();
    if (currentId === ticketId) {
      var rowIndex = i + 2; // 1-indexed & header offset
      
      // すでに引換済みの場合はエラーレスポンスを返す（重複防止）
      var currentStatus = values[i][6].toString();
      if (currentStatus === '引換済') {
        var existingTime = values[i][7] ? formatDate(values[i][7]) : '';
        return createJsonResponse({ 
          success: false, 
          reason: 'already_exchanged',
          exchange_time: existingTime,
          name: values[i][2].toString(),
          ban: values[i][1].toString(),
          tickets: parseInt(values[i][5], 10) || 1,
          notes: values[i][9].toString()
        });
      }
      
      // G列（ステータス）を「引換済」に設定
      sheet.getRange(rowIndex, 7).setValue('引換済');
      // H列（引換日時）に現在時刻を設定
      sheet.getRange(rowIndex, 8).setValue(exchangeTime);
      
      return createJsonResponse({ success: true, id: ticketId });
    }
  }
  
  return createJsonResponse({ success: false, reason: 'Ticket ID not found' });
}

// 手動で新規レコードを追加
function registerTicket(record) {
  var sheet = getMasterSheet();
  
  var newRow = [
    record.id,
    record.ban,
    record.name,
    record.kana,
    record.phone,
    record.tickets,
    record.status,
    record.exchange_time,
    record.method,
    record.notes
  ];
  
  sheet.appendRow(newRow);
  return createJsonResponse({ success: true, id: record.id });
}

// 次のチケットID（FES-XXXX）を生成
function generateNextIdOnSheet(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return "FES-0001";
  }
  
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var maxNum = 0;
  
  for (var i = 0; i < ids.length; i++) {
    var match = ids[i][0].toString().match(/^FES-(\d+)$/);
    if (match) {
      var num = parseInt(match[1], 10);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  }
  
  var nextNum = maxNum + 1;
  return "FES-" + ("0000" + nextNum).slice(-4);
}

// Googleフォーム送信時の自動処理（トリガー設定が必要）
function onFormSubmit(e) {
  try {
    var sheet = getMasterSheet();
    var namedValues = e.namedValues;
    
    // フォームの質問名から値を取得 (大文字小文字・前後のスペースを自動トリミングして安全に読み込む)
    var email = getFormValue(namedValues, ["メールアドレス", "メール アドレス", "Email"]);
    var name = getFormValue(namedValues, ["氏名", "お名前", "名前"]);
    var kana = getFormValue(namedValues, ["フリガナ", "ふりがな"]);
    var ban = getFormValue(namedValues, ["班名", "所属班"]);
    var phone = getFormValue(namedValues, ["電話番号", "連絡先"]);
    var ticketsStr = getFormValue(namedValues, ["チケット枚数", "枚数", "チケットの枚数"]);
    var notes = getFormValue(namedValues, ["備考", "特記事項", "メッセージ"]) || "";
    
    var tickets = parseInt(ticketsStr, 10) || 1;
    
    if (!name || !ban || !email) {
      Logger.log("必須情報が不足しているため処理を中断しました。");
      return;
    }
    
    // チケットIDを自動生成
    var ticketId = generateNextIdOnSheet(sheet);
    
    // 引換マスターシートに書き込み
    var newRow = [
      ticketId,
      ban,
      name,
      kana,
      phone,
      tickets,
      "未使用",      // ステータス初期値
      "",           // 引換日時
      "デジタル",    // 受付方法
      notes         // 備考
    ];
    sheet.appendRow(newRow);
    
    // QRコードのURLを生成 (QR Server API を使用)
    var qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=" + encodeURIComponent(ticketId);
    
    // QRコード画像をAPIから取得して添付ファイルにする
    var qrResponse = UrlFetchApp.fetch(qrUrl);
    var qrBlob = qrResponse.getBlob().setName("qrcode_" + ticketId + ".png");
    
    // メール送信
    sendConfirmationEmail(email, name, ticketId, ban, tickets, qrBlob);
    
    Logger.log("フォーム送信処理完了: ID=" + ticketId + " メール送信先=" + email);
  } catch (error) {
    Logger.log("フォーム処理エラー: " + error.toString());
  }
}

// 表記ブレに対応したフォーム回答の取得ヘルパー
function getFormValue(namedValues, keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (namedValues[key] && namedValues[key][0]) {
      return namedValues[key][0].toString().trim();
    }
  }
  return "";
}

// 申込者へメールを送信する
function sendConfirmationEmail(email, name, ticketId, ban, tickets, qrBlob) {
  var subject = "【自治会お祭り】チケット事前申込受付・引換用QRコードのご案内";
  
  var htmlBody = 
    "<div style='font-family:sans-serif; max-width:600px; margin:0 auto; padding:20px; border:1px solid #e5e7eb; border-radius:12px; color:#1f2937;'>" +
      "<h2 style='color:#0284c7; border-bottom:2px solid #0284c7; padding-bottom:8px;'>前売りチケットの申込完了</h2>" +
      "<p>" + name + " 様</p>" +
      "<p>自治会のお祭りチケット事前お申し込み、誠にありがとうございます。<br>以下の通り受付を完了いたしました。</p>" +
      
      "<div style='background-color:#f3f4f6; padding:15px; border-radius:8px; margin:20px 0;'>" +
        "<table style='width:100%; border-collapse:collapse;'>" +
          "<tr><td style='padding:5px 0; color:#4b5563; width:120px;'><strong>引換用チケットID</strong></td><td>" + ticketId + "</td></tr>" +
          "<tr><td style='padding:5px 0; color:#4b5563;'><strong>ご登録の班名</strong></td><td>" + ban + "</td></tr>" +
          "<tr><td style='padding:5px 0; color:#4b5563;'><strong>チケット枚数</strong></td><td>" + tickets + " 枚</td></tr>" +
        "</table>" +
      "</div>" +
      
      "<h3 style='color:#0f172a; margin-top:20px;'>【当日受付での引換方法】</h3>" +
      "<p>お祭り当日、受付テントにて<strong>本メールに添付されているQRコード</strong>（または画面下に表示されているQRコード）をスタッフの端末に提示してください。</p>" +
      
      "<div style='text-align:center; margin:30px 0; padding:15px; border:1px dashed #cbd5e1; border-radius:8px;'>" +
        "<p style='margin:0 0 10px 0; font-size:14px; color:#64748b;'>▼ 当日提示用QRコード（チケットID: " + ticketId + "）</p>" +
        "<img src='cid:qrImageInline' style='width:180px; height:180px; border:1px solid #e2e8f0;' alt='QRコード' />" +
      "</div>" +
      
      "<hr style='border:0; border-top:1px solid #e5e7eb; margin:20px 0;' />" +
      "<p style='font-size:12px; color:#64748b; line-height:1.5;'>" +
        "※本メールは自動送信されています。<br>" +
        "※QRコードは各世帯で一回のみ引換可能です。重複引換はできませんので管理にご注意ください。<br>" +
        "※スマホでの提示が難しい場合は、本メールを印刷してご持参いただくか、受付スタッフに直接お名前・班名をお伝えください。" +
      "</p>" +
    "</div>";

  MailApp.sendEmail({
    to: email,
    subject: subject,
    htmlBody: htmlBody,
    inlineImages: {
      qrImageInline: qrBlob
    }
  });
}

// JSONレスポンスの生成 (CORS対応のためのユーティリティ)
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// 日時型のデータを「YYYY-MM-DD HH:mm:ss」文字列に変換
function formatDate(dateVal) {
  if (dateVal instanceof Date) {
    return Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  return dateVal.toString();
}
