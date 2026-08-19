/**
 * 自治会お祭りチケット引換管理システム - Google Apps Script (GAS) APIスクリプト
 * 
 * 【導入手順】
 * 1. Googleスプレッドシートを開きます。
 * 2. スプレッドシートのメニューから「拡張機能」＞「Apps Script」を開きます。
 * 3. 元からあるコードを消去し、本スクリプト（Code.js）の内容を貼り付けます。
 * 4. エディタ右上にある「デプロイ」＞「新しいデプロイ」をクリックします。
 * 5. 種類の選択で「ウェブアプリ」を選択します。
 * 6. 設定を以下のように指定します:
 *    - 説明: 任意 (例: Ticket API v3 - 部分引換対応)
 *    - 次のユーザーとして実行: 自分 (あなたのメールアドレス)
 *    - アクセスできるユーザー: 全員
 * 7. 「デプロイ」ボタンを押し、表示される「ウェブアプリのURL」をコピーして、アプリの設定画面に貼り付けます。
 */

// 「引換マスター」シート名
var MASTER_SHEET_NAME = "引換マスター";

// マスターシートを取得（存在しない場合は自動作成してヘッダーを設定。既存の場合はK列を自動追加して移行）
function getMasterSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  var headers = ["チケットID", "班名", "氏名", "フリガナ", "電話番号", "チケット枚数", "ステータス", "引換日時", "受付方法", "備考", "引換済枚数"];
  
  if (!sheet) {
    sheet = ss.insertSheet(MASTER_SHEET_NAME);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
    sheet.setFrozenRows(1);
  } else {
    // 移行措置: 現在の列数が11列未満（K列がない）場合、K列にヘッダーを追加
    var maxCol = sheet.getLastColumn();
    if (maxCol < headers.length) {
      sheet.getRange(1, headers.length).setValue(headers[headers.length - 1]);
      sheet.getRange(1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
    }
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
      var count = parseInt(postData.exchange_count, 10) || 1;
      return exchangeTicket(postData.id, count, postData.exchange_time);
    } else if (action === 'register') {
      return registerTicket(postData.record);
    }
    
    return createJsonResponse({ error: 'Invalid POST action' });
  } catch (error) {
    return createJsonResponse({ error: error.toString() });
  }
}

// スプレッドシートから全データを取得（K列「引換済枚数」を読み込み、過去データ互換性を保持）
function readDatabase() {
  var sheet = getMasterSheet();
  var rows = sheet.getDataRange().getValues();
  
  var data = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[0]) continue; // 空行はスキップ
    
    var appliedTickets = parseInt(row[5], 10) || 1;
    var status = row[6].toString();
    
    // K列（インデックス10）が存在し空欄でなければ値を使用。空欄の場合はステータスが「引換済」なら申込枚数と同数、そうでなければ0とする
    var exchangedCount = 0;
    if (row.length > 10 && row[10] !== "") {
      exchangedCount = parseInt(row[10], 10);
    } else if (status === "引換済") {
      exchangedCount = appliedTickets;
    }
    
    data.push({
      id: row[0].toString(),
      ban: formatBanValue(row[1]),
      name: row[2].toString(),
      kana: row[3].toString(),
      phone: row[4].toString(),
      tickets: appliedTickets,
      exchanged_count: exchangedCount,
      status: status,
      exchange_time: row[7] ? formatDate(row[7]) : '',
      method: row[8].toString(),
      notes: row[9].toString()
    });
  }
  
  return createJsonResponse(data);
}

// チケットIDを検索し、指定された枚数分を引き換える（残数チェックおよびステータス自動判定）
function exchangeTicket(ticketId, exchangeCount, exchangeTime) {
  var sheet = getMasterSheet();
  var lastRow = sheet.getLastRow();
  
  if (lastRow < 2) {
    return createJsonResponse({ success: false, reason: 'Empty database' });
  }
  
  // A列からK列まで一括取得
  var range = sheet.getRange(2, 1, lastRow - 1, 11);
  var values = range.getValues();
  
  for (var i = 0; i < values.length; i++) {
    var currentId = values[i][0].toString();
    if (currentId === ticketId) {
      var rowIndex = i + 2; // 1-indexed & header offset
      
      var appliedTickets = parseInt(values[i][5], 10) || 1;
      var currentStatus = values[i][6].toString();
      
      // K列（インデックス10）から現在の引換数を取得（過去データ互換対応）
      var currentExchanged = 0;
      if (values[i].length > 10 && values[i][10] !== "") {
        currentExchanged = parseInt(values[i][10], 10);
      } else if (currentStatus === "引換済") {
        currentExchanged = appliedTickets;
      }
      
      var remaining = appliedTickets - currentExchanged;
      
      // すでに全数引換済みの場合はエラーを返す
      if (remaining <= 0 || currentStatus === '引換済') {
        var existingTime = values[i][7] ? formatDate(values[i][7]) : '';
        return createJsonResponse({ 
          success: false, 
          reason: 'already_exchanged',
          status: '引換済',
          exchanged_count: currentExchanged,
          exchange_time: existingTime,
          name: values[i][2].toString(),
          ban: formatBanValue(values[i][1]),
          tickets: appliedTickets,
          notes: values[i][9].toString()
        });
      }
      
      // 今回の引換数が残数を超えている場合はエラー
      if (exchangeCount > remaining) {
        return createJsonResponse({
          success: false,
          reason: 'exceeds_remaining',
          message: '引換数が残数（' + remaining + '枚）を超えています。',
          status: currentStatus,
          exchanged_count: currentExchanged,
          tickets: appliedTickets
        });
      }
      
      // 新しい累計引換数を計算
      var newExchanged = currentExchanged + exchangeCount;
      
      // ステータスを判定
      var newStatus = '未使用';
      if (newExchanged === appliedTickets) {
        newStatus = '引換済';
      } else if (newExchanged > 0) {
        newStatus = '一部引換済';
      }
      
      // G列（ステータス）を更新
      sheet.getRange(rowIndex, 7).setValue(newStatus);
      // H列（引換日時）に現在時刻を設定
      sheet.getRange(rowIndex, 8).setValue(exchangeTime);
      // K列（引換済枚数）を更新
      sheet.getRange(rowIndex, 11).setValue(newExchanged);
      
      return createJsonResponse({ 
        success: true, 
        id: ticketId,
        status: newStatus,
        exchanged_count: newExchanged,
        exchange_time: exchangeTime
      });
    }
  }
  
  return createJsonResponse({ success: false, reason: 'Ticket ID not found' });
}

// 新規レコードを追加
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
    record.notes,
    record.exchanged_count || 0 // K列: 新規登録時は指定がなければ0
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
    var email = getFormValue(namedValues, ["メールアドレス", "メール アドレス", "Email", "メール"]);
    var name = getFormValue(namedValues, ["氏名", "お名前", "名前", "代表者"]);
    var kana = getFormValue(namedValues, ["フリガナ", "ふりがな", "かな"]);
    var ban = getFormValue(namedValues, ["班名", "所属班", "班"]);
    var phone = getFormValue(namedValues, ["電話番号", "連絡先", "電話", "携帯"]);
    var ticketsStr = getFormValue(namedValues, ["チケット枚数", "枚数", "チケットの枚数", "チケット", "希望枚数", "購入枚数", "購入数"]);
    var notes = getFormValue(namedValues, ["備考", "特記事項", "メッセージ"]) || "";
    
    // 全角数字を半角に変換して安全にパース
    var normalizedTickets = normalizeNumber(ticketsStr);
    var tickets = parseInt(normalizedTickets, 10) || 1;
    
    if (!name || !ban || !email) {
      Logger.log("必須情報が不足しているため処理を中断しました。");
      return;
    }
    
    // チケットIDを自動生成
    var ticketId = generateNextIdOnSheet(sheet);
    
    // 引換マスターシートに書き込み（K列に0を書き込む）
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
      notes,        // 備考
      0             // 引換済枚数 (Col 11)
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

// 表記ブレに対応したフォーム回答の取得ヘルパー（完全一致および大文字小文字を区別しない部分一致に対応）
function getFormValue(namedValues, keys) {
  // 1. 完全一致で検索
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (namedValues[key] && namedValues[key][0]) {
      return namedValues[key][0].toString().trim();
    }
  }
  
  // 2. 部分一致で検索（大文字小文字を区別せず、引数のキーワードがフォームの質問名に含まれるか）
  var allKeys = Object.keys(namedValues);
  for (var j = 0; j < keys.length; j++) {
    var searchKey = keys[j].toLowerCase();
    for (var k = 0; k < allKeys.length; k++) {
      var formKey = allKeys[k].toLowerCase();
      if (formKey.indexOf(searchKey) !== -1 && namedValues[allKeys[k]][0]) {
        return namedValues[allKeys[k]][0].toString().trim();
      }
    }
  }
  return "";
}

// 全角数字を半角数字に変換するヘルパー
function normalizeNumber(str) {
  if (!str) return "";
  return str.toString().replace(/[０-９]/g, function(s) {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  });
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
          "<tr><td style='padding:5px 0; color:#4b5563;'><strong>ご登録 of 班名</strong></td><td>" + ban + "</td></tr>" +
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

// 班名の日付誤判定（Googleスプレッドシートの仕様による日付変換）を安全に文字列（M-d）に戻すクリーンアップ関数
function formatBanValue(val) {
  if (val === null || val === undefined) {
    return "";
  }
  if (val instanceof Date) {
    return (val.getMonth() + 1) + "-" + val.getDate();
  }
  return val.toString().trim();
}
