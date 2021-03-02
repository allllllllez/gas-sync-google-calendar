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
var SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/foobar';

// copy config
var COPIED_PREFIX = '【△】';
var COPIED_DESC = '【copied event】';

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
      deleteCopyEventIfOriginRemoved(event, guestId, sourceId);
    });
  });
}

function syncStatus(event, guest){
  var sourceStatus = event.getMyStatus();
  var guestStatus = guest.getGuestStatus();
  
  if(guestStatus != CalendarApp.GuestStatus.YES && guestStatus != CalendarApp.GuestStatus.NO) return;
  if((sourceStatus == CalendarApp.GuestStatus.YES || sourceStatus == CalendarApp.GuestStatus.NO) && sourceStatus != guestStatus){
    
    // Notify when source status is opposite from guest's status
    // notify('Failed to sync the status of the event: ' + event.getTitle() + ' (' + event.getStartTime() + ')');
  }
  else if(sourceStatus != guestStatus && sourceStatus != CalendarApp.GuestStatus.OWNER){
    // Update status when my status is invited/maybe AND guest's status is yes/no
    event.setMyStatus(guestStatus);
    Logger.log('Status updated:' + event.getTitle() + ' (' + event.getStartTime() + ')');
  }
}

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
      {guests: guestId, description: COPIED_DESC + "\n" + event.getDescription()}
    );
  }
}



function deleteCopyEventIfOriginRemoved(copyEvent, guestId, sourceId) {
  if (!copyEvent.getTitle().startsWith(COPIED_PREFIX)) {
    return true;
  }

  var events = CalendarApp.getCalendarById(sourceId).getEvents(copyEvent.getStartTime(), copyEvent.getEndTime());
  var isOrgExist = !!events.find(element => (
            element.getTitle() == copyEvent.getTitle().slice(COPIED_PREFIX.length) &&
            element.getStartTime().toString() == copyEvent.getStartTime().toString() &&
            element.getEndTime().toString() == copyEvent.getEndTime().toString()));

  if (!isOrgExist && copyEvent.getGuestList().length == 1 &&
        !!copyEvent.getGuestByEmail(guestId) && copyEvent.getDescription().startsWith(COPIED_DESC)) {
    copyEvent.deleteEvent();
  }
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