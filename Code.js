/**
 * 自治会お祭りチケット引換管理システム - Google Apps Script (GAS) APIスクリプト
 * 
 * 【導入手順】
 * 1. Googleスプレッドシートを新規作成します。
 * 2. 1行目にヘッダーを定義します（左から順に10列）:
 *    A列: チケットID  | B列: 班名 | C列: 氏名 | D列: フリガナ | E列: 電話番号 | F列: チケット枚数 | G列: ステータス | H列: 引換日時 | I列: 受付方法 | J列: 備考
 * 3. スプレッドシートのメニューから「拡張機能」＞「Apps Script」を開きます。
 * 4. 元からあるコードを消去し、本スクリプト（Code.js）の内容を貼り付けます。
 * 5. エディタ右上にある「デプロイ」＞「新しいデプロイ」をクリックします。
 * 6. 種類の選択で「ウェブアプリ」を選択します。
 * 7. 設定を以下のように指定します:
 *    - 説明: 任意 (例: Ticket API v1)
 *    - 次のユーザーとして実行: 自分 (あなたのメールアドレス)
 *    - アクセスできるユーザー: 全員 (※全員にしないとアプリから通信できません)
 * 8. 「デプロイ」ボタンを押し、表示される「ウェブアプリのURL」をコピーして、アプリの設定画面に貼り付けます。
 */

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
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var rows = sheet.getDataRange().getValues();
  
  // 1行目はヘッダー行
  var header = rows[0];
  var data = [];
  
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    // 空行はスキップ
    if (!row[0]) continue; 
    
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

// チケットIDを検索し、引換済みに更新
function exchangeTicket(ticketId, exchangeTime) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
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

// 新規レコードを追加
function registerTicket(record) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
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
