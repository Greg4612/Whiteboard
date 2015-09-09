(function () {
  var appRoom;
  
  // The MessageManager object, for sending and receiving messages
  var msgManager = orbiter.getMessageManager();
  // A convenience reference to net.user1.orbiter.UPC, which provides a
  // list of valid client/server UPC messages. See: http://unionplatform.com/specs/upc/
  var UPC = net.user1.orbiter.UPC;
  // A hash of client attribute names used in this application. Each client sets a
  // "thickness" attribute and a "color" attribute, specify the thickness and 
  // color of the current line being drawn.
  var Attributes = {THICKNESS:"thickness", 
                    COLOR:"color"};
  // A hash of room message names used in this application. MOVE means move the
  // drawing pen to the specified position. PATH supplies a list of points to be
  // drawn.
  var Messages = {MOVE:"MOVE", 
                  PATH:"PATH"};
  
  var isPenDown = false;
  
  // Line defaults
  var defaultLineColor = "red";
  var defaultLineThickness = 1;
  var maxLineThickness = 70;
  
  // Tracks the current location of the user's drawing pen
  var localPen = {};
  
  // The user's line styles 
  var localLineColor = defaultLineColor;
  var localLineThickness = defaultLineThickness;
  
  // A list of points in a path to send to other connected users
  var bufferedPath = [];
  // A timestamp indicating the last time a point was added to the bufferedPath
  var lastBufferTime = new Date().getTime();
  
  var userCurrentPositions = {};
  // A hash of pending drawing commands sent by remote users, the following format: 
  //  {"2345": [{commandName:moveTo, arg:{x:10, y:10}}, {commandName:lineTo, arg:{x:55, y:35}}]};
  var userCommands = {};
  // A hash of line colors for remote users, in the following format:
  //  {"2345": "#CCCCCC"};
  var userColors = {};
  // A hash of line thicknesses for remote users, in the following format:
  //  {"2345": 5};
  var userThicknesses = {};
  
  var canvas;
  // The drawing canvas's context, through which drawing commands are performed
  var context;
  // A hash of drawing commands executed by UnionDraw's rendering process
  var DrawingCommands = {LINE_TO:       "lineTo",
                         MOVE_TO:       "moveTo",
                         SET_THICKNESS: "setThickness",
                         SET_COLOR:     "setColor"};
  
  var broadcastPathIntervalID;
  // The ID for a timer that executes drawing commands sent by remote users
  var processDrawingCommandsIntervalID;
  
  var hasTouch = false;
  
  init();
  function init () {
    initCanvas();
    registerInputListeners();
    iPhoneToTop();
    orbiter.addEventListener(net.user1.orbiter.OrbiterEvent.READY, readyListener, this);
	
    // If Orbiter has already connected, start this component    
    if (orbiter.isReady()) {
      start();
    }
  }
  
  // Triggered when the connection to Union Server is ready
  function readyListener (e) {
    start();
  }
  
  // Triggered when the connection to Union Server is closed
  function closeListener (e) {
    // Stop drawing content sent by other users
    clearInterval(processDrawingCommandsIntervalID);
  }
  
  // Start this component
  function start () {
    // Periodically execute drawing commands sent by other users
    processDrawingCommandsIntervalID = setInterval(processDrawingCommands, 20);
    
    // Register for UPC messages from Union Server
    msgManager.addMessageListener(UPC.ROOM_OCCUPANTCOUNT_UPDATE, 
                                  roomOccupantCountUpdateListener, this);  
    msgManager.addMessageListener(UPC.ROOM_SNAPSHOT, roomSnapshotListener, this);
    msgManager.addMessageListener(UPC.CLIENT_ATTR_UPDATE, clientAttributeUpdateListener, this);
    msgManager.addMessageListener(UPC.CLIENT_REMOVED_FROM_ROOM, clientRemovedFromRoomListener, this);
    
    // Register for custom messages from other users
    msgManager.addMessageListener(Messages.MOVE, moveMessageListener, this, [appRoomID]);
    msgManager.addMessageListener(Messages.PATH, pathMessageListener, this, [appRoomID]);
  }
  
    // Set up the drawing canvas
  function initCanvas () {
    // Retrieve canvas reference
    canvas = document.getElementById("canvas");
    
    // If IE8, do IE-specific canvas initialization (required by excanvas.js)
    if (typeof G_vmlCanvasManager != "undefined") {
      this.canvas = G_vmlCanvasManager.initElement(this.canvas);
    }
    
    // Size canvas
    canvas.width  = 2000;
    canvas.height = 2000;
    
    // Retrieve context reference, used to execute canvas drawing commands
    context = canvas.getContext('2d');
    context.lineCap = "round";
	
    // Set control panel defaults
    document.getElementById("thickness").selectedIndex = 0;
    document.getElementById("color").selectedIndex = 1;
  }
 
  // Register callback functions to handle user input
  function registerInputListeners () {
    canvas.onmousedown = pointerDownListener;
    document.onmousemove = pointerMoveListener;
    document.onmouseup = pointerUpListener;
    document.ontouchstart = touchDownListener;
    document.ontouchmove = touchMoveListener;
    document.ontouchend = touchUpListener;
    document.getElementById("thickness").onchange = thicknessSelectListener;
    document.getElementById("color").onchange = colorSelectListener;
    
     // bind event handler to clear button
    document.getElementById('clear').addEventListener('click', function() {context.clearRect(0, 0, canvas.width, canvas.height);}, false);
    document.getElementById('save').addEventListener('click', function() {window.open(canvas.toDataURL("image/png"),"","width=700,height=700");}, false);

  }
  


  function roomOccupantCountUpdateListener (appRoomID, numOccupants) {
    numOccupants = parseInt(numOccupants);
  }
  
  function roomSnapshotListener (requestID,
                                 appRoomID,
                                 occupantCount,
                                 observerCount,
                                 roomAttributes) {
    var clientList = Array.prototype.slice.call(arguments).slice(5);
    var clientID;
    var roomAttrString;
    var roomAttrs;
    var attrName;
    var attrVal;
    
    for (var i = 0; i < clientList.length; i+=5) {
      clientID = clientList[i];
      // Each client's room-scoped client attributes are passed as a 
      // pipe-delimited string. Split that string to get the attributes.
      clientAttrString = clientList[i+4];
      clientAttrs = clientAttrString == "" ? [] : clientAttrString.split("|");
      
      // Pass each client attribute to processClientAttributeUpdate(), which will
      // check for the "thickness" and "color" attributes.
      for (var j = 0; j < clientAttrs.length; j++) {
        attrName = clientAttrs[j];
        attrVal  = clientAttrs[j+1];
        processClientAttributeUpdate(clientID, attrName, attrVal);
      }
    }
  }
  
  function clientAttributeUpdateListener (attrScope, 
                                          clientID,
                                          userID,
                                          attrName,
                                          attrVal,
                                          attrOptions) { 
    if (attrScope == appRoomID) {
      processClientAttributeUpdate(clientID, attrName, attrVal);
    }
  }
  
  // Triggered when a clients leaves the drawing room.
  function clientRemovedFromRoomListener (appRoomID, clientID) {
    // The client is gone now, so remove all information pertaining to that client
    delete userThicknesses[clientID];
    delete userColors[clientID];
    delete userCommands[clientID];
    delete userCurrentPositions[clientID];
  }
  
  // Checks for changes to the the "thickness" and "color" attributes.
  function processClientAttributeUpdate (clientID, attrName, attrVal) {
    if (attrName == Attributes.THICKNESS) {
      // The "thickness" attribute changed, so push a "set thickness" command
      // onto the drawing command stack for the specified client. But first, 
      // bring the thickness into legal range if necessary (prevents thickness hacking).
      addDrawingCommand(clientID, DrawingCommands.SET_THICKNESS, getValidThickness(attrVal));
    } else if (attrName == Attributes.COLOR) {
      // The "color" attribute changed, so push a "set color" command
      // onto the drawing command stack for the specified client
      addDrawingCommand(clientID, DrawingCommands.SET_COLOR, attrVal);
    }
  }
  
  function moveMessageListener (fromClient, coordsString) {
    // Parse the specified (x, y) coordinate
    var coords = coordsString.split(",");
    var position = {x:parseInt(coords[0]), y:parseInt(coords[1])};
    // Push a "moveTo" command onto the drawing-command stack for the sender
    addDrawingCommand(fromClient.getClientID(), DrawingCommands.MOVE_TO, position);
  }
  
  // Triggered when a remote client sends a "PATH" message to this client
  function pathMessageListener (fromClient, pathString) {
    // Parse the specified list of points
    var path = pathString.split(",");
    
    // For each point, push a "lineTo" command onto the drawing-command stack 
    // for the sender
    var position;
    for (var i = 0; i < path.length; i+=2) {
      position = {x:parseInt(path[i]), y:parseInt(path[i+1])};
      addDrawingCommand(fromClient.getClientID(), DrawingCommands.LINE_TO, position);
    }
  }
  
  function broadcastPath () {
    // If there aren't any points buffered (e.g., if the pen is down but not
    // moving), then don't send the PATH message.
    if (bufferedPath.length == 0) {
      return;
    }
    msgManager.sendUPC(UPC.SEND_MESSAGE_TO_ROOMS, 
                       Messages.PATH, 
                       appRoomID, 
                       "false", 
                       "", 
                       bufferedPath.join(","));
    // Clear the local user's outgoing path data
    bufferedPath = [];
    // If the user is no longer drawing, stop broadcasting drawing information
    if (!isPenDown) {
      clearInterval(broadcastPathIntervalID);
    }
  }
  
  // Sends all users in the drawing room an instruction to reposition the local
  // user's pen.
  function broadcastMove (x, y) {
    msgManager.sendUPC(UPC.SEND_MESSAGE_TO_ROOMS, 
                       Messages.MOVE, 
                       appRoomID, 
                       "false", 
                       "", 
                       x + "," + y);
  }
  
  function addDrawingCommand (clientID, commandName, arg) {
    // If this client does not yet have a command stack, make one. 
    if (userCommands[clientID] == undefined) {
      userCommands[clientID] = [];
    }
    // Push the command onto the stack.
    var command = {};
    command["commandName"] = commandName;
    command["arg"] = arg;
    userCommands[clientID].push(command);
  }
  
  // Executes the oldest command on all user's command stacks
  function processDrawingCommands () {
    var command;
    // Loop over all command stacks
    for (var clientID in userCommands) {
      // Skip empty stacks
      if (userCommands[clientID].length == 0) {
        continue;
      }
      
      // Execute the user's oldest command
      command = userCommands[clientID].shift();
      switch (command.commandName) {
        case DrawingCommands.MOVE_TO:
          userCurrentPositions[clientID] = {x:command.arg.x, y:command.arg.y};
          break;
          
        case DrawingCommands.LINE_TO:
          if (userCurrentPositions[clientID] == undefined) {
            userCurrentPositions[clientID] = {x:command.arg.x, y:command.arg.y};
          } else {
            drawLine(userColors[clientID] || defaultLineColor, 
                     userThicknesses[clientID] || defaultLineThickness, 
                     userCurrentPositions[clientID].x, 
                     userCurrentPositions[clientID].y,
                     command.arg.x, 
                     command.arg.y);
             userCurrentPositions[clientID].x = command.arg.x; 
             userCurrentPositions[clientID].y = command.arg.y; 
          }
          break;
          
        case DrawingCommands.SET_THICKNESS:
          userThicknesses[clientID] = command.arg;
          break;
          
        case DrawingCommands.SET_COLOR:
          userColors[clientID] = command.arg;
          break;
      }
    }
  }
  
  function touchDownListener (e) {
    // Note that this device supports touch so that we can prevent conflicts with
    // mouse input events.
    hasTouch = true;
    
    // Ignore off-canvas touches
    if (event.target.id != "canvas") {
      return;
    }
    
    // Prevent the touch from scrolling the page.
    e.preventDefault();
    
    // Determine where the user touched screen.
    var canvasPos = getPos(canvas);
    var touchX = e.changedTouches[0].clientX - canvasPos.x;
    var touchY = e.changedTouches[0].clientY - canvasPos.y;
    // A second "touch start" event may occur if the user touches the screen with
    // two fingers. Ignore the second event if the pen is already down.
    if (!isPenDown) {
      // Move the drawing pen to the position that was touched
      penDown(touchX, touchY);
    }
  }
  
  // On devices that support touch input, this function is triggered when the user
  // drags a finger across the screen.
  function touchMoveListener (e) {
    hasTouch = true;
    
    if (isPenDown) {
      e.preventDefault();
      var canvasPos = getPos(canvas);
      var touchX = e.changedTouches[0].clientX - canvasPos.x;
      var touchY = e.changedTouches[0].clientY - canvasPos.y;
      // Draw a line to the position being touched.
      penMove(touchX, touchY);
    }
  }

  // On devices that support touch input, this function is triggered when the 
  // user stops touching the screen.
  function touchUpListener () {
    // "Lift" the drawing pen, so lines are no longer drawn
    penUp();
  }
  
  function pointerDownListener (e) {
    // If this is an iPhone, iPad, Android, or other touch-capable device, ignore
    // simulated mouse input.
    if (hasTouch) {
      return;
    }
    
    // Retrieve a reference to the Event object for this mousedown event.
    // Internet Explorer uses window.event; other browsers use the event parameter
    var event = e || window.event;
     
    // Determine where the user clicked the mouse.
    var canvasPos = getPos(canvas);
    var mouseX = event.clientX - canvasPos.x;
    var mouseY = event.clientY - canvasPos.y;
    
    // Move the drawing pen to the position that was clicked
    penDown(mouseX, mouseY);
    
    // We want mouse input to be used for drawing only, so we need to stop the 
    // browser from/ performing default mouse actions, such as text selection. 
    // In Internet Explorer, we "prevent default actions" by returning false. In 
    // other browsers, we invoke event.preventDefault().
    if (event.preventDefault) {
      if (event.target.nodeName != "SELECT") {
        event.preventDefault();
      }
    } else {
      return false;  // IE
    }
  }
  
  // Triggered when the mouse moves
  function pointerMoveListener (e) {
    if (hasTouch) {
      return;
    }
    var event = e || window.event; // IE uses window.event, not e
    var canvasPos = getPos(canvas);
    var mouseX = event.clientX - canvasPos.x;
    var mouseY = event.clientY - canvasPos.y;
    
    // Draw a line if the pen is down
    penMove(mouseX, mouseY);
  
    // Prevent default browser actions, such as text selection
    if (event.preventDefault) {
      event.preventDefault();
    } else {
      return false;  // IE
    }
  }
  
  // Triggered when the mouse button is released
  function pointerUpListener (e) {
    if (hasTouch) {
      return;
    }
    // "Lift" the drawing pen
    penUp();
  }
  
  function thicknessSelectListener (e) {
    // Determine which option was selected
    var newThickness = this.options[this.selectedIndex].value;
    // Locally, set the line thickness to the selected value
    localLineThickness = getValidThickness(newThickness);
    msgManager.sendUPC(UPC.SET_CLIENT_ATTR, 
                       orbiter.getClientID(),
                       "",
                       Attributes.THICKNESS,
                       newThickness,
                       appRoomID,
                       "4");
    iPhoneToTop();
  }
  
  // Triggered when an option in the "line color" menu is selected
  function colorSelectListener (e) {
    // Determine which option was selected
    var newColor = this.options[this.selectedIndex].value;
    // Locally, set the line color to the selected value
    localLineColor = newColor;
    // Share selected color with other users
    msgManager.sendUPC(UPC.SET_CLIENT_ATTR, 
                       orbiter.getClientID(),
                       "",
                       Attributes.COLOR,
                       newColor,
                       appRoomID,
                       "4");
  
    // Scroll the iPhone back to the top-left. 
    iPhoneToTop();
  }
  
  function penDown (x, y) {
    isPenDown = true;
    localPen.x = x;
    localPen.y = y;
    
    // Send this user's new pen position to other users.
    broadcastMove(x, y);
    
    // Begin sending this user's drawing path to other users every 500 milliseconds.
    broadcastPathIntervalID = setInterval(broadcastPath, 500);
  }
  
 //Save the Canvas
  function onSave() {
    var img = context.toDataURL("image/png");
    window.open(img,"","width=700,height=700");
  }
  // Draws a line if the pen is down.
  function penMove (x, y) { 
    if (isPenDown) {
      // Buffer the new position for broadcast to other users. Buffer a maximum
      // of 100 points per second.
      if ((new Date().getTime() - lastBufferTime) > 10) {
        bufferedPath.push(x + "," + y);
        lastBufferTime = new Date().getTime();
      }
      
      // Draw the line locally.
      drawLine(localLineColor, localLineThickness, localPen.x, localPen.y, x, y);
      
      // Move the pen to the end of the line that was just drawn.
      localPen.x = x;
      localPen.y = y;
    }
  }
  
  // "Lifts" the drawing pen, so that lines are no longer draw when the mouse or
  // touch-input device moves.
  function penUp () {
    isPenDown = false;
  }
  
  // Draws a line on the HTML5 canvas
  function drawLine (color, thickness, x1, y1, x2, y2) {
    context.strokeStyle = color;
    context.lineWidth   = thickness;
    
    context.beginPath();
    context.moveTo(x1, y1)
    context.lineTo(x2, y2);
    context.stroke();
  }
  
  //Save the Canvas
  function onSave() {
	 
    window.open(context.toDataURL("image/png"),"","width=700,height=700");
  }
  
  // Returns the x,y position of the supplied HTML element
  function getPos (obj) {
    var curleft = curtop = 0;
    if (obj.offsetParent) {
      do {
        curleft += obj.offsetLeft;
        curtop += obj.offsetTop;
      }
      while (obj = obj.offsetParent);
      return {x:curleft, y:curtop};
    }
  }
  
  // Hides the iPhone address bar by scrolling it out of view
  function iPhoneToTop () {
    if (navigator.userAgent.indexOf("iPhone") != -1) {
      setTimeout (function () {
        window.scroll(0, 0);
      }, 100);
    }
  }
  
  function getValidThickness (value) {
    value = parseInt(value);
    var thickness = isNaN(value) ? defaultLineThickness : value;
    return Math.max(1, Math.min(thickness, maxLineThickness));
  }
})();
