'use strict';

// Getting packages
//=======================================================

var express             = require('express');
var router              = express.Router();
var config              = require('../config/config');
var moment		        = require('moment');
var Promise		        = require('bluebird');
var Info 		        = require('./models/Info');
var User		        = require('./models/User');
var WebNotification     = require('./models/WebNotification');
var Controller          = require('./controller.js');
var Cleaner             = require('./cleaner');
var bcrypt              = require('bcrypt');
var jwt                 = require('jsonwebtoken');
var reCAPTCHA           = require('recaptcha2');

//Set the hash salt for encrypt
const saltRounds = 10;

//reCAPTCHA setup
var recaptcha = new reCAPTCHA({
    siteKey: config.googlePublic,
    secretKey: config.googleSecret
});

// Export the router
module.exports  = router;

// API Routes
router


// POST register
//==============================================

.post('/user/register', function(req, res, next) {

    //Checking inputs

    if( Controller.isUsernameValid(req.body.username) && 
        Controller.isUserMailValid(req.body.mail) && 
        Controller.isUserPasswordValid(req.body.password)) {

        var tempUsername   = Controller.sanitizeString(req.body.username);
    var tempUserMail   = Controller.sanitizeString(req.body.mail);
    var isEmailVisible = Controller.checkBoolean(req.body.isEmailVisible);

        // Checking Google Recaptcha

        if(req.body.gRecaptchaResponse === undefined || req.body.gRecaptchaResponse === '' || req.body.gRecaptchaResponse === null) {
            res.status(400).json({message: 'No Captcha found.'});
        }
        else{
            var key = req.body.gRecaptchaResponse;
            recaptcha.validate(key)
            .then(function(){

                // Checking database for email or username
                
                Promise.props({
                   username: User.findOne({username: tempUsername}, 'username').execAsync(),
                   mail: User.findOne({mail: tempUserMail}, 'mail').execAsync()
               })
                .then(function(results) {
                    if(results.username !== null)
                        res.status(400).json({success: false, message: 'Username already exists'});
                    else if(results.mail !== null)
                        res.status(400).json({success: false, message: 'Mail already exists'});
                    else {
                        var user = new User({
                            username:   tempUsername,
                            password:   req.body.password,
                            mail:       tempUserMail
                        });
                        if(isEmailVisible)
                            user.isEmailVisible = true;
                        //Hash password and save
                        bcrypt.hash(req.body.password, saltRounds, function(err, hash) {
                            user.password = hash;
                            user.save(function(err, resp) {
                                if(err) {
                                    console.log('Error when trying to register an user: '+err);
                                    res.status(500).send(err);
                                }
                                res.status(200).json({
                                    success: true,
                                    message: 'Successfully registered !'
                                });
                            });  
                        });
                    }
                })
                .catch(function(err) {
                    console.log(err);
                    res.status(500); // oops - we're even handling errors!
                });
            })
            .catch(function(errorCodes){
                // Invalid Captcha
                res.status(500).json({message: 'Unknown error when validate the Captcha'});
                console.log('reCAPTCHA error: ' +recaptcha.translateErrors(errorCodes));// translate error codes to human readable text
            });
        } // End ELSE Google recaptcha
    }
    else {
        res.status(400).json({success: false, message: 'Bad request, invalid inputs'});
    }
})


// LOGIN
//==============================================

.post('/user/login', function(req, res, next) {

    //Checking inputs

    if( Controller.isUsernameValid(req.body.username) && 
        Controller.isUserPasswordValid(req.body.password)) {

        // Checking Google Recaptcha

    if(req.body.gRecaptchaResponse === undefined || req.body.gRecaptchaResponse === '' || req.body.gRecaptchaResponse === null) {
        res.status(400).json({message: 'No Captcha found.'});
    }
    else{
        var key = req.body.gRecaptchaResponse;
        recaptcha.validate(key)
        .then(function(){

            Promise.props({
                user: User.findOne({username: req.body.username}).execAsync()
            })
            .then(function(results) {
                if(results.user !== null) {
                        // Load hash from your password DB.
                        bcrypt.compare(req.body.password, results.user.password, function(err, resp) {
                            if(err) {
                                console.log('Error when checking password: '+ err);
                                res.status(500).json({success: false, message: 'Error when checking password'});
                            }
                            if(resp === true) {

                                var userData = {
                                    userID: results.user._id,
                                    username: results.user.username,
                                    mail: results.user.mail,
                                    isEmailVisible: results.user.isEmailVisible
                                };

                                // we check if a cookie already exists
                                var cookie = req.cookies.token;
                                if (cookie === undefined) {

                                    var token = jwt.sign(userData, config.secret, {
                                        expiresIn: '3h',
                                        issuer: 'API-auth',
                                        audience: 'web-frontend'
                                    });
                                    res.cookie('access_token', token, {
                                        path: '/',
                                        domain: config.domain,
                                        httpOnly: true,
                                        secure: true,
                                        signed: true,
                                        maxAge: 10800000 // 3H
                                    }).status(200).json({
                                        success: true,
                                        message: 'User connected',
                                        idUser: userData.userID,
                                        JWT: token
                                    }); 
                                }
                                else{
                                    res.status(200).json({
                                        success: true,
                                        message: 'User connected',
                                        idUser: userData.userID
                                    });    
                                }
                            }
                            else {
                                res.status(400).json({success: false, message: 'wrong password'});
                            }
                        });
                    }
                    else {
                        res.status(400).json({success: false, message: 'User not found'});
                    }
                });
        });
    }
}
})


// Getting informations by type
//===========================================

.get('/infos/', function(req, res, next) {
    Info.find().sort({voteCount: -1}).exec(function(err, infos) {
        if(err) {
            console.log('Error when trying to get all infos');
            res.status(500).send(err);
        }
        res.status(200).json(infos);
    });
})

// Checking token
//===========================================

.use(function(req, res, next) {

    //check header or url params or post params for token
    var cookieParser = req.app.get('cookieParser');
    var token = req.signedCookies.access_token;
    //var token = cookieParser.signedCookie(req.signedCookies['access_token'], config.cookieSecret);

    //decode token
    if(token === undefined) {
        //if there is no token : return error
        return res.status(403).send({
            success: false,
            message: 'No token provided.'
        });
    }
    else if( token === false) {
        //if there token invalid : return error
        return res.clearCookie('access_token').status(403).send({
            success: false,
            message: 'Signature not recognized.'
        });
    }
    else {
        //verifies secret and checks expiry
        jwt.verify(token, config.secret, function(err, decoded) {
            if(err) {
                return res.clearCookie('access_token').status(403).json({ success: false, message: 'Failed to authenticate token'});
            }
            else {
                //if everything good save to request for use in other Routes
                req.decoded = decoded;
                next();
            }
        });
    }
})


// POST new informations
//=============================================

.post('/infos', function(req, res, next) {

    // User ID checking

    if( !(Controller.isObjectIDValid(req.decoded.userID)) ) {
        res.status(400).send({success: false, message: 'Invalid userID'});
    }
    else{

        // DATE CHECKING
        var tempExpiryDate = moment(req.body.expirydate, moment.ISO_8601);
        var tempBirthDate = moment();
        if(req.body.birthdate !== '' && req.body.birthdate !== undefined) {
            tempBirthDate = moment(req.body.birthdate, moment.ISO_8601);
        }
        var timeFromNow = tempBirthDate.diff(moment());
        var timeFromBirth = tempExpiryDate.diff(tempBirthDate);
        if( timeFromNow < 0 || timeFromNow > config.infoTTL * 86400000) {                   // 86400000 = 24h
            res.status(400).send({success: false, message: 'Invalid birthdate'});
        }
        else if( timeFromBirth < 0 || timeFromBirth > 86400000) {                           // 24 in ms
            res.status(400).send({success: false, message: 'Invalid expirydate'});
        }
        else {
        	
          var info = new Info({

            title: 			Controller.sanitizeString(req.body.title),
            description: 	Controller.sanitizeString(req.body.description),
            birthdate: 		tempBirthDate,
            expirydate: 	tempExpiryDate,
            category: 		Controller.sanitizeString(req.body.category),
            location: 		Controller.sanitizeString(req.body.location),
            addInfo: 		Controller.sanitizeString(req.body.addInfo),
            userID: 		req.decoded.userID,
            acceptComments: Controller.checkBoolean(req.body.acceptComments)
        });
          if(info.category === 'Event') {
            info.userLimit = req.body.userLimit;
            info.acceptOverload = Controller.checkBoolean(req.body.acceptOverload);
            info.userList.push({ ID: req.decoded.userID, username: req.decoded.username});
        }
        info.save(function(err, resp) {
            if(err) {
                console.log('Error when adding info');
                res.status(500).send(err);
            }
            else {
                var io = req.app.get('socketio');
                io.emit('newInfo', info);
                res.status(200).json({success: true, message: 'Successfully added'});
            }
        });
    }
}
})


// GET info by userID
//===============================================

.get('/infos/user/:id', function(req, res, next) {

    // Checking userID
    if( !(Controller.isObjectIDValid(req.params.id)) ) {
        res.status(400).send({success: false, message: 'Invalid userID'});
    }
    else {
        Info.find({userID: req.params.id}, function(err, infos) {
            if(err) {
                console.log('Error when trying to get infos for User ID: '+req.params.id);
                res.status(500).send(err);
            }
            else {
                res.status(200).json(infos);
            }
        });
    }
})


// GET info by id
//==============================================

.get('/infos/id/:id', function(req, res, next) {

    //Checking info ID 
    if( !(Controller.isObjectIDValid(req.params.id)) ) {
        res.status(400).send({success: false, message: 'Invalid infoID'});
    }
    else {
        Info.findOne({_id: req.params.id}, function(err, info) {
            if(err) {
                console.log('Error when trying to get the info id: '+req.params.id);
                res.status(500).send(err);
            }
            else {
                res.status(200).json(info);
            }
        });
    }
})


// UPDATE informations
//==============================================

.post('/infos/update/:id', function(req, res, next) {

    // IDs Cheking

    if( !(Controller.isObjectIDValid(req.decoded.userID)) ) {
        res.status(400).send({success: false, message: 'Invalid userID'});
    }
    else {
        var userID = req.decoded.userID;

    // DATE Checking

    var tempBirthDate = moment(req.body.birthdate, moment.ISO_8601);
    var tempExpiryDate = moment(req.body.expirydate, moment.ISO_8601);
    var timeFromBirth = tempExpiryDate.diff(tempBirthDate);
        if( timeFromBirth < 0 || timeFromBirth > 86400000) {           // 24h in ms
            res.status(400).send({success: false, message: 'Invalid expirydate'});
            console.log(timeFromBirth);
        }

    // INFO Handling

    else {
        if( !(Controller.isObjectIDValid(req.params.id)) ) {
            res.status(400).send({success: false, message: 'Invalid Info ID'});
        }
        else {
            var infoID = req.params.id;
            Info.findOne({_id: infoID, userID: userID}, function(err, info) {
                if(err) {
                    console.log('Error when trying to get the info to update: '+err);
                    res.status(500).send({success: false, message: 'Error when trying to get the info'});
                }
                if(info) {
                    if(info.userID === userID) {
                       info.updateInfos(req.body);
                       Info.update({_id: info._id}, info, function(err) {
                        if(err) {
                            console.log('Error when updating info: '+err);
                            res.status(500).send({success: false, message: 'Error when updating info'});
                        }
                        else {
                            var io = req.app.get('socketio');
                            io.emit('updateInfo', info);
                            res.status(200).send({success: true, message: 'Info updated'});
                        
                            // Notifications
                            WebNotification.find({infoID: info._id}, "-infoID -userID", function(err, subUsers) {
                                if(err) {
                                    console.log('Error when trying to get SubUsers from info ID: '+info._id);
                                }
                                else {
                                    if(subUsers.length !== 0 && subUsers !== undefined) {
                                        
                                        var message = {
                                            content: "The info '" +Controller.decodeHTML(info.title) +"' just has been edited.",
                                            url: "info/" +info._id 
                                        };

                                        WebNotification.pushMessage(subUsers, message);  
                                    }
                                }
                            });
                        }
                    }); 
                   }
                   else {
                    res.status(403).send({success: false, message: 'You are not authorized to update this info'});
                }
            }
            else {
                res.status(404).send({success: false, message: 'No info found'});
            }
        });
        }
    }
}
})


// DELETE informations
//==============================================

.delete('/infos/delete/:id', function(req, res, next) {

    // Cheking userID
    if( !(Controller.isObjectIDValid(req.decoded.userID)) ) {
        res.status(400).send({success: false, message: 'Invalid userID'});
    }
    else {
        if (!(Controller.isObjectIDValid(req.params.id)) )
            res.status(400).send({success: false, message: 'Info ID is invalid'});
        else {
            Info.findOneAndRemove({_id: req.params.id, userID: req.decoded.userID}, function(err, info) {
                if(err) {
                    console.log('Error when trying to delete the info');
                    res.status(500).send(err);
                }
                if(info) {
                    console.log('Info removed');
                    res.status(200).json({success: true, message: 'Info removed'});
                    var io = req.app.get('socketio');
                    io.emit('deleteInfo', info);
                    Cleaner.cleanNotifications(info._id);
                }
                else {
                    res.status(404).send({success: false, message: 'There is no info with this ID or you are to authorized to delete it'});
                }
            });
        }
    }
})


// JOIN Event
//==============================================

.post('/infos/:id/join', function(req, res, next) {

    // ID Checking

    if( !(Controller.isObjectIDValid(req.decoded.userID)) ) {
        res.status(400).send({success: false, message: 'Invalid userID'});
    }
    else if ( !(Controller.isObjectIDValid(req.params.id)) ) {
        res.status(400).send({success: false, message: 'Invalid Event ID'});
    }
    else {
        var userID  = req.decoded.userID;
        var username= req.decoded.username;
        var eventID = req.params.id;
        //Finding the user
        User.findOne({_id: userID}, function(err, user) {
            if(err) {
                console.log('Error when checking user identity');
                res.status(500).send({success: false, message: 'Error when checking user identity'});
            }
            if(!user) {
                res.status(404).send({success: false, message: 'Bad request : Unknown user id'});
            }
            else {
                Info.findOne({_id: eventID}, function(err, event) {
                    if(err) {
                        console.log('Error when trying to find event to join: '+err);
                        res.status(500).send(err);
                    }
                    // The event requested exists
                    if(event) {
                        if(event.category === 'Event') {
                            if(event.isFull()) {
                                res.status(409).send({success: false, message: 'Event is full'});
                            }
                            else {
                                var isUserAlreadyIn = false;
                                var i = event.userList.length - 1;
                                while (i >= 0) {
                                    if(event.userList[i].ID === userID) {
                                        isUserAlreadyIn = true;
                                        res.status(409).send({success: false, message: 'User already in the event'});
                                        //break while
                                        i = -1;
                                    }
                                    i--;
                                }
                                if(!isUserAlreadyIn) {
                                    event.userList.push({ID: userID, username: username});
                                    Info.update({_id: eventID}, event, function(err) {
                                        if(err) {
                                            console.log('Error when updating the event after user joined: '+err);
                                            res.status(500).send({success: false, message: 'Error when updating the event'});
                                        }
                                        res.status(200).send({success: true, message: 'Event joined'});
                                        var io = req.app.get('socketio');
                                        io.emit('joinEvent', {'ID': event._id, 'userID': userID, 'username': username});
                                    });
                                }
                            }  
                        }
                        // Info found but not an event
                        else {
                            res.status(404).send({success: false, message: 'No event found'});
                        }
                    }
                    // No info found
                    else {
                        res.status(404).send({success: false, message: 'No event found'});
                    }
                });
            }
        });
    }
})


// LEAVE Event
//=============================================

.post('/infos/:id/leave', function(req, res, next) {

    // ID Checking

    if( !(Controller.isObjectIDValid(req.decoded.userID)) ) {
        res.status(400).send({success: false, message: 'Invalid userID'});
    }
    else if ( !(Controller.isObjectIDValid(req.params.id)) ) {
        res.status(400).send({success: false, message: 'Invalid Event ID'});
    }
    else {
        var eventID = req.params.id;
        var username= req.decoded.username;
        var userID  = req.decoded.userID;

        // Find info
        Info.findOne({_id: eventID}, function(err, event) {
            if(err) {
                console.log('Error when trying to find the event to leave: '+err);
                res.status(500).send(err);
            }
            // If info found
            if(event) {
                // If info is an event
                if(event.category === 'Event') {
                    var isUserIn = false;
                    var i = event.userList.length - 1;
                    while (i >= 0) {
                        if(event.userList[i].ID === userID) {
                            isUserIn = true;
                            event.userList.pull();
                            Info.update({_id: eventID}, {$pull: { userList: {ID: userID} } }, function(err) {
                                if(err) {
                                    console.log('Error when updating event after user leaving: '+err);
                                    res.status(500).send(err);
                                }
                                res.status(200).send({success: true, message: 'user removed from event'});
                                var io = req.app.get('socketio');
                                io.emit('leaveEvent', {'ID': event._id, 'userID': userID});
                            });
                            //Break the while
                            i = -1;
                        }
                        i--;
                    }
                    if(!isUserIn) {
                        res.status(404).send({success: false, message: 'user not found in the event'});
                    }
                }
                // Info found but not an event
                else {
                    res.status(404).send({success: false, message: 'Event not found'});
                }
            }
            // Info not found
            else {
                res.status(404).send({success: false, message: 'Event not found'});
            }
        });
    }
}) 


// POST New comment
//==============================================

.post('/infos/:id/comment', function(req, res, next) {

    //Check ID
    if( !(Controller.isObjectIDValid(req.params.id)) ||
        !(Controller.isObjectIDValid(req.decoded.userID)) ) {

        res.status(400).send({success: false, message: 'Invalid ID'});
    }
    else {
        var infoID = req.params.id;
        //Search Info
        Info.findOne({_id: infoID}, function(err, info) {
            if(err) {
                console.log('Error when adding comment');
                res.status(500).send(err);
            }
            // If info found
            if(info) {
                if(info.acceptComments) {
                    var newComment = {
                        title:      Controller.sanitizeString(req.body.title),
                        content:    Controller.sanitizeString(req.body.content),
                        userID:     req.decoded.userID,
                        username:   req.decoded.username
                    };
                    info.comments.push(newComment);
                    Info.update({_id: info._id}, info, function(err) {
                        if(err) {
                            res.status(500).send(err);
                            console.log(err);
                        }
                        else {
                            res.status(200).send({success: true, message: 'Comment added!'});
                            newComment._id = info.comments[info.comments.length-1]._id;
                            var io = req.app.get('socketio');
                            io.emit('newComment', {infoID: info._id, content: newComment});

                            WebNotification.find({infoID: info._id}, "-infoID -userID", function(err, subUsers) {
                                if(err) {
                                    console.log('Error when trying to get SubUsers from info ID: '+info._id);
                                }
                                else {
                                    if(subUsers.length !== 0 && subUsers !== undefined) {
                                        
                                        var message = {
                                            content: "Someone added a new comment on '" +Controller.decodeHTML(info.title) +"'",
                                            url: "info/" +info._id 
                                        };
                                        WebNotification.pushMessage(subUsers, message);  
                                    }
                                }
                            });
                        } // end else
                    });
                }
                // Accept Comments is set to false
                else {
                    res.status(400).send({success: false, message: 'The info doesn\'t accept comments.'});
                }
            }
            // No info found
            else {
                res.status(404).send({success: false, message: 'No info found'});
            }
        });       
    }
})


// UPDATE Comment
//==============================================

.post('/infos/:infoID/comment/:commentID', function(req, res, next) {

    //Check ID
    if( !(Controller.isObjectIDValid(req.params.infoID))  ||
        !(Controller.isObjectIDValid(req.decoded.userID)) ||
        !(Controller.isObjectIDValid(req.params.commentID)) ) {

        res.status(400).send({success: false, message: 'Invalid ID'});
    }
    else {
        Info.findOne({_id: req.params.infoID}, function(err, info) {
            if(err) {
                console.log('Error when searching info:'+err);
                res.status(500).send(err);
            }
            // If info found
            if(info) {
                var isFound = false;
                var i = info.comments.length - 1;
                while (i >= 0) {
                    //Comment found
                    if(info.comments[i]._id == req.params.commentID) {
                        isFound = true;
                        //Checking the ownership
                        if(info.comments[i].userID == req.decoded.userID) {
                            info.comments[i].edit(req.body);
                            Info.update({_id: info._id}, info, function(err) {
                                if(err) {
                                    console.log('error when updating comment' +err);
                                    res.status(500).send(err);
                                }
                                else {
                                    var io = req.app.get('socketio');
                                    io.emit('commentEdited', {infoID: info._id, content: req.body });
                                    res.status(200).send({success: true, message: 'Comment updated'});
                                }
                            });    
                        }
                        // Error not the owner
                        else {
                            res.status(403).send({success: false, message: 'Permission denied: You are not the owner'});
                        }
                        //break loop
                        i = -1;
                    }
                    i--;
                }
                //Comment not found
                if(!isFound) {
                    res.status(404).send({success: false, message: 'Comment not found'});
                }
            }
            // No info found
            else {
                res.status(404).send({success: false, message: 'No info found'});
            }
        });
    }

})


// DELETE Comment
//==============================================

.delete('/infos/:infoID/comment/:commentID', function(req, res, next) {

    //Check ID
    if( !(Controller.isObjectIDValid(req.params.infoID))  ||
        !(Controller.isObjectIDValid(req.decoded.userID)) ||
        !(Controller.isObjectIDValid(req.params.commentID)) ) {

        res.status(400).send({success: false, message: 'Invalid ID'});
    }
    else {
        Info.findOne({_id: req.params.infoID}, function(err, info) {
            if(err) {
                console.log('Error when searching info:'+err);
                res.status(500).send(err);
            }
            // If info found
            if(info) {
                var isFound = false;
                var i = info.comments.length - 1;
                while (i >= 0) {
                    //Comment found
                    if(info.comments[i]._id == req.params.commentID) {
                        isFound = true;
                        //Checking the ownership
                        if(info.comments[i].userID == req.decoded.userID) {
                            info.comments.splice(info.comments.indexOf(i), 1);
                            Info.update({_id: info._id}, info, function(err) {
                                if(err) {
                                    console.log('error when deleting comment' +err);
                                    res.status(500).send(err);
                                }
                                else {
                                    var io = req.app.get('socketio');
                                    io.emit('commentDeleted', {infoID: info._id, ID: req.params.commentID});
                                    res.status(200).send({success: true, message: 'Comment deleted'});
                                }
                            });    
                        }
                        // Error not the owner
                        else {
                            res.status(403).send({success: false, message: 'Permission denied: You are not the owner'});
                        }
                        //break loop;
                        i = -1;
                    }
                    i--;
                }
                //Comment not found
                if(!isFound) {
                    res.status(404).send({success: false, message: 'Comment not found'});
                }
            }
            // No info found
            else {
                res.status(404).send({success: false, message: 'No info found'});
            }
        });
    }
})


//Check if the current user has subscribed to the info
//=============================================

.get('/infos/:id/subscription/:device', function(req, res, next) {

    //Check ID
    if( !(Controller.isObjectIDValid(req.params.id)) ||
        !(Controller.isObjectIDValid(req.decoded.userID)) ) {

        res.status(400).send({success: false, message: 'Invalid ID'});
    }
    else {
        var userID      = req.decoded.userID;
        var infoID      = req.params.id;
        var device      = req.params.device;

        WebNotification.findOne({infoID: infoID, userID: userID, device: device}, function(err, notif) {
            if(err) {
                console.log('Error when getting WebNotification from infoID:' +infoID);
                console.log(err);
                res.status(500).send(err);
            }
            else if(notif) {
                res.status(200).send({success: true, notif});
            }
            else {
                res.status(200).send({success: false, message: 'Not subscribed'});
            }
        });
    }
})


//Subscribe current user to the info
//==============================================

.post('/infos/:id/subscribe', function(req, res, next) {

    //Check ID
    if( !(Controller.isObjectIDValid(req.params.id)) ||
        !(Controller.isObjectIDValid(req.decoded.userID)) ) {

        res.status(400).send({success: false, message: 'Invalid ID'});
    }
    else {
        var userID      = req.decoded.userID;
        var infoID      = req.params.id;
        var device      = Controller.sanitizeString(req.body.device);

        //Search if the user is already subscribed
        WebNotification.findOne({infoID: infoID, userID: userID, device: device}, function(err, webNotif) {
            if(err) {
                console.log('Error when trying to retrieve webnotification for info' +infoID);
                console.log(err);
                res.status(500).send(err);
            }
            else if(webNotif) {
                res.status(400).send({success: false, message: 'You already subscribed to this info'});
            }
            else {
                var newSubscribtion = new WebNotification ({
                    infoID:     infoID,
                    userID:     userID,
                    playerID:   Controller.sanitizeString(req.body.playerID),
                    device:     Controller.sanitizeString(req.body.device)
                });

                newSubscribtion.save(function(err, resp) {
                    if(err) {
                        console.log('Error when saving new subscription:');
                        console.log(err);
                        res.status(500).send(err);
                    }
                    else {
                        res.send({success: true, message: 'subscription validated'});
                    }
                });
            }
        });
    }

})


//Remove subscription of info for the current user
//==============================================

.delete('/infos/:id/unsubscribe/:device', function(req, res, next) {

    //Check ID
    if( !(Controller.isObjectIDValid(req.params.id)) ||
        !(Controller.isObjectIDValid(req.decoded.userID)) ) {

        res.status(400).send({success: false, message: 'Invalid ID'});
    }
    else {
        var userID      = req.decoded.userID;
        var infoID      = req.params.id;
        var device      = req.params.device;

        WebNotification.findOne({infoID: infoID, device: device}).remove(function(err, result) {
            if(err) {
                console.log('Error when trying to unsubscribe:');
                console.log(err);
                res.status(500).send(err);
            }
            else if(result) {
                res.status(200).send({success: true, message: 'Unsubscribed'});
            }
            else {
                res.status(404).send({success: false, message: 'No subscription found'});
            }
        });
    }
})


// POST add upvote/downvote
//==============================================

.post('/infos/:id/:votetype', function(req, res, next) {

    //Check ID
    if( !(Controller.isObjectIDValid(req.params.id)) ||
        !(Controller.isObjectIDValid(req.decoded.userID)) ) {

        res.status(400).send({success: false, message: 'Invalid ID'});
    }
    else if ( !(Controller.isVoteTypeValid(req.params.votetype)) ) {
        res.status(400).send({success: false, message: 'Bad request'});
    }
    else {
        var userID      = req.decoded.userID;
        var infoID      = req.params.id;
        var votetype    = req.params.votetype === 'upvote'?(1):(-1);

        Info.findOne({_id: infoID}, function(err, info) {
            if(err) {
                console.log('Error when updating votes');
                res.status(500).send(err);
            }
            // If info found
            if(info) {
                var vote;
                var isVoteExist = false;
                // We search if the user already added a vote
                var i = info.votes.length -1;
                while (i >= 0) {
                    vote = info.votes[i];
                    if(vote.userID === userID) {
                        isVoteExist = true;
                        vote.value == votetype ? vote.value = 0 : vote.value = votetype;
                        info.updateVoteCount();
                        Info.update({_id: infoID}, info, function(err) {
                            if(err) {
                                console.log('Error when updating the info: '+err);
                                res.status(500).send({success: false, message: 'Error when updating the info'});
                            }
                            res.status(200).send({success: true, message: 'Vote updated !'});
                            var io = req.app.get('socketio');
                            io.emit('voteUpdated', {'ID': infoID, 'voteCount': info.voteCount});
                        });
                        i = -1; 
                    }
                    i--;
                } // END WHILE

                // If no vote found, we add a new one
                if(!isVoteExist) {
                    info.votes.push({userID: userID, value: votetype});
                    info.updateVoteCount();
                    Info.update({_id: infoID}, info, function(err) {
                        if(err) {
                            console.log('Error when updating the info: '+err);
                            res.status(500).send({success: true, message: 'Error when updating the info'});
                        }
                        res.status(200).send({success: true, message: 'Vote sent !'});
                        var io = req.app.get('socketio');
                        io.emit('voteUpdated', {'ID': infoID, 'voteCount': info.voteCount});
                    });
                } 
            }
            //No info found
            else {
                res.status(404).send({success: false, message: 'No info found'});
            }
        });
    }
})


// GET all users
//==============================================

.get('/users', function(req, res, next) {
    User.find({}, '-password', function(err, users) {
        if(err) {
            console.log('Error when trying to get all users');
            res.status(500).send(err);
        }
        if(users) {
            users.forEach(function(user){
                if(user.isEmailVisible === false)
                    user.mail = '';
            });
            res.status(200).json(users);
        }
        else {
            res.status(404).json({success: false, message: 'No users found'});
        }
    });
})


// Disconnect (Delete Cookie)
//=============================================

.delete('/user/disconnect', function(req, res, next) {
    res.clearCookie('access_token', {path: '/', secure: true, httpOnly: true, signed: true, domain: config.domain}).status(200).send({success: true, message: 'Disconnected'});
})


// GET user by ID
//==============================================

.get('/user/id/:id', function(req, res, next) {
    if(Controller.isObjectIDValid(req.params.id)) {
        var id = req.params.id;
        User.findOne({_id: id}, '-password', function(err, user) {
            if(err) {
                console.log('error when trying to get the user by id');
                res.status(500).send(err);
            }
            if(user) {
                if(user.isEmailVisible === false) {
                    user.mail = '';
                }
            }
            res.status(200).json(user);
        });
    }
    else {
        res.status(400).json({success: false, message: 'Bad request'});
    }
})


// GET user by name
//==============================================

.get('/user/name/:name', function(req, res, next) {
    
    //Check names
    if(Controller.isUsernameValid(req.params.name)) {
        var name = Controller.sanitizeString(req.params.name);

        User.findOne({username: name}, '-password', function(err, user) {
            if(err) {
                console.log('error when trying to get the user by name');
                res.status(500).send(err);
            }

            //If user found
            if(user) {
                if(user.isEmailVisible === false) {
                    user.mail = '';
                }
            }
            res.status(200).json(user);        
        });    
    }
    else {
        res.status(400).json({success: false, message: 'Bad request'});
    }    
})

// Get My Profile
//============================================

.get('/user/myprofile', function(req, res, next) {
    var userID = req.decoded.userID;

    User.findOne({_id: userID}, '-password', function(err, user) {
        if(err) {
            console.log('error when trying to get the user profile');
            res.status(500).send(err);
        }
        else if(user) {
            res.status(200).json(user);
        }
        else {
            res.status(404).send({message: 'ID error, sign-in again please'});
        }
    });
})

// POST update user
//=============================================

.post('/user/update', function(req, res, next) {

    //Check datas
    var checkPwd          = false;
    var checkEmail        = false;
    var checkVisible      = false;

    if(Controller.checkBoolean(req.body.isNewPwd) && Controller.isUserPasswordValid(req.body.password)) {
        checkPwd = true;
    }
    if( Controller.checkBoolean(req.body.isNewEmail) && Controller.isUserMailValid(req.body.mail)) {
        checkEmail = true;
    }
    if( Controller.checkBoolean(req.body.isNewVisible) ) {
        checkVisible = true;
    }
    if(checkPwd === false && checkEmail === false && checkVisible === false ) {
        res.status(400).send({success: false, message: 'Bad request, nothing to change'});
    }
    else {
        var username            = Controller.sanitizeString(req.decoded.username);
        var newPassword         = req.body.newPassword;
        var newEmail            = Controller.sanitizeString(req.body.newEmail);
        var newIsEmailVisible   = Controller.checkBoolean(req.body.isEmailVisible);

        Promise.props({
            user: User.findOne({username: username}).execAsync()
        })
        .then(function(results) {
            if(results.user !== null) {
                if(checkVisible)
                    results.user.isEmailVisible = newIsEmailVisible; 
                if(checkEmail)
                    results.user.mail = newEmail;
                if(checkPwd) {
                    //Hash password
                    bcrypt.hash(newPassword, saltRounds, function(err, hash) {
                        results.user.password = hash;
                        results.user.save(function(err, resp) {
                            if(err) {
                                console.log('Error when trying to update the user: '+results.user.username);
                                res.status(500).send(err);
                            }
                            res.status(200).send({success: true, message: 'Successfully updated'});
                        });  
                    });
                }
                else {
                    results.user.save(function(err, resp) {
                        if(err) {
                            console.log('Error when trying to update the user: '+results.user.username);
                            res.status(500).send(err);
                        }
                        res.status(200).send({success: true, message: 'Successfully updated'});
                    });
                }
            }
            else 
                res.status(404).send({success: false, message: 'User doesn\'t exist'});
        });  
    }
})


// DELETE user
//=============================================

.delete('/user/delete', function(req, res, next) {

    // Check ID
    if(! (Controller.isObjectIDValid(req.decoded.userID)) ) {
        res.status(400).send({success: false, message: 'Invalid ID'});
    }
    else {
        var userID = req.decoded.userID;
        User.findOneAndRemove({_id: userID}, function(err, user) {
            if(err) {
                console.log('Error when deleting user');
                res.status(500).send(err);
            }
            if(user){
                //Delete all info of the user
                Info.remove({userID: userID }, function(err) {
                    if(err) {
                        console.log('Error when trying to delete infos of the deleted user');
                    }
                });
                res.status(200).send({success: true, message: 'User Deleted'});
            }
            else {
                res.status(404).send({success: false, message: 'User not found'});
            }
        });
    }
})



// ERRORS
//=============================================   
.use(function(req, res, next){
    res.status(404).send('Error 404 : Request not found');
});