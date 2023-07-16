// README
// Instruction: https://github.com/soetani/gas-sync-google-calendar

// 1. How many days do you want to sync your calendars?
var DAYS_TO_SYNC = 30;

// 2. Calendar ID mapping: [Calendar ID (Source), Calendar ID (Guest)]
var CALENDAR_IDS = [
  ['source_01@example.com', 'guest_01@example.net'],
  ['source_02@example.com', 'guest_02@example.net']
];

// 3. What is Slack webhook URL? You'll be notified when the sync is failed
var SLACK_WEBHOOK_URL = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
if (!SLACK_WEBHOOK_URL) {
  throw 'You should set "SLACK_WEBHOOK_URL" property from [File] > [Project properties] > [Script properties]';
}

// copy config
var COPIED_PREFIX = '【△】';
var COPIED_DESC_PREFIX = '【copied event from ';
var COPIED_DESC_SUFFIX = '】'

/**
  CALENDAR_IDS に指定したカレンダー間で、イベントを同期する。

  Source 側カレンダーに入っているスケジュールに、、、
  - Guest 側IDがあったら、ステータス同期させる
  - Guest 側IDがなかったら、 Invite する（Invite出来ない場合は、スケジュールを Guest 側にコピーする）
  
  また、同期したスケジュールが変更されていた場合、変更を同期する
*/
function main(){
  var dateFrom = new Date();
  var dateTo = new Date(dateFrom.getTime() + (DAYS_TO_SYNC * 24 * 60 * 60* 1000));
  
  CALENDAR_IDS.forEach(function(ids){
    var sourceId = ids[0];
    var guestId = ids[1];
    Logger.log('Source: ' + sourceId + ' / Guest: ' + guestId);
    
    var events = CalendarApp.getCalendarById(sourceId).getEvents(dateFrom, dateTo);
    events.forEach(function(event){
      var guest = event.getGuestByEmail(guestId);
      guest ? syncStatus(event, guest) : invite(event, guestId, sourceId);

      // if copied original event was move, delete copy event.
      reflectCopyEventIfOriginChanged(event, guestId, sourceId);
    });
  });
}

/**
  Source 側ステータスで Guest 側ステータスを更新する

  @param {CalendarEvent} event - 同期するスケジュール
  @param {CalendarEventGuest} guest - スケジュール上の Guest 側ID情報
*/
function syncStatus(event, guest){
  var sourceStatus = event.getMyStatus();
  var guestStatus = guest.getGuestStatus();
  
  if (
    guestStatus != CalendarApp.GuestStatus.YES
    && guestStatus != CalendarApp.GuestStatus.NO
    && guestStatus != CalendarApp.GuestStatus.MAYBE
  ) return;
  if (
    (
      sourceStatus == CalendarApp.GuestStatus.YES
      || sourceStatus == CalendarApp.GuestStatus.NO
      || sourceStatus == CalendarApp.GuestStatus.MAYBE
    ) || sourceStatus != guestStatus
  ){  
    // Notify when source status is opposite from guest's status
    // notify('Failed to sync the status of the event: ' + event.getTitle() + ' (' + event.getStartTime() + ')');
  }
  else if(sourceStatus != guestStatus && sourceStatus != CalendarApp.GuestStatus.OWNER){
    // Update status when my status is invited/maybe AND guest's status is yes/no
    event.setMyStatus(guestStatus);
    Logger.log('Status updated:' + event.getTitle() + ' (' + event.getStartTime() + ')');
  }
}

/**
  Guest 側IDをスケジュールに招待する
  
  @param {CalendarEvent} event - 招待するスケジュール
  @param {string} guestId - Guest 側ID
  @param {string} sourceId - Source 側ID
*/
function invite(event, guestId, sourceId){
  var result = event.addGuest(guestId);
  Logger.log('Invited: ' + event.getTitle() + ' (' + event.getStartTime() + ')');
  if(!result.getGuestByEmail(guestId) && !event.getTitle().startsWith(COPIED_PREFIX)) {
    // invite failed, create copy event
    createCopyEvent(
      event,
      sourceId,
      guestId
    );
  }
}

/**
  スケジュールをコピーして新しいイベントを作成する

  @param {CalendarEvent} event - コピー元のスケジュール
  @param {string} sourceId - Source 側ID
  @param {string} guestId - Guest 側ID
*/
function createCopyEvent(event, sourceId, guestId) {
  // check already copied event created
  var events = CalendarApp.getCalendarById(sourceId).getEvents(event.getStartTime(), event.getEndTime());
  var isExist = !!events.find(element => (
            element.getTitle() == COPIED_PREFIX + event.getTitle() &&
            element.getStartTime().toString() == event.getStartTime().toString() &&
            element.getEndTime().toString() == event.getEndTime().toString()));
  if(!isExist) {
    // not exist copy event, then create.
    CalendarApp.getCalendarById(sourceId).createEvent(
      COPIED_PREFIX + event.getTitle(), event.getStartTime(), event.getEndTime(),
      {guests: [guestId, sourceId].toString(), description: COPIED_DESC_PREFIX + sourceId + COPIED_DESC_SUFFIX + "\n" + event.getDescription()}
    );
  }
}

/**
  元のスケジュールが変更された場合に、コピー先に変更を反映する

  @param {CalendarEvent} copyEvent - 反映させるコピー先スケジュール
  @param {string} guestId - Guest 側ID
  @param {string} sourceId - Source 側ID
  
  @returns {boolean} - 反映処理が実行されたかどうか。反映したら true、していなければ false
*/
function reflectCopyEventIfOriginChanged(copyEvent, guestId, sourceId) {
  if (!copyEvent.getTitle().startsWith(COPIED_PREFIX)) {
    // Skip if not event start copied_prefix
    return false;
  }
  var isInviter = copyEvent.getCreators().join() === sourceId;
  if (!isInviter) {
    // Skip if not copy event inviter
    return false;
  }
  
  var events = CalendarApp.getCalendarById(sourceId).getEvents(copyEvent.getStartTime(), copyEvent.getEndTime());
  var orgEvent = events.find(element => (
    element.getTitle() == copyEvent.getTitle().slice(COPIED_PREFIX.length) &&
    element.getStartTime().toString() == copyEvent.getStartTime().toString() &&
    element.getEndTime().toString() == copyEvent.getEndTime().toString()));
    
    if (orgEvent == undefined) {
      // Skip if not copy event inviter
      return false;
    }

    if (!orgEvent && copyEvent.getGuestList().length == 1 &&
    !!copyEvent.getGuestByEmail(guestId) && copyEvent.getCreators().join() === sourceId){
      // delete copyEvent if orginal event is deleted or moved
      copyEvent.deleteEvent();
      return false;
    }
    
    if (copyEvent.getDescription() === undefined || orgEvent.getDescription() === undefined) {
      // Skip if not copy event inviter
    return false;
  }

  if (copyEvent.getDescription() !== COPIED_DESC_PREFIX + sourceId + COPIED_DESC_SUFFIX + "\n" + orgEvent.getDescription()) {
    // reflect copyEvent description if original event description is changed
    copyEvent.setDescription(COPIED_DESC_PREFIX + sourceId + COPIED_DESC_SUFFIX + "\n" + orgEvent.getDescription());
  }

  return true;
}

function notify(message){
  var data = {'text': message};
  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(data)
  };
  UrlFetchApp.fetch(SLACK_WEBHOOK_URL, options);
}
