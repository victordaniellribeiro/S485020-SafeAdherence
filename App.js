Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',


    _initDate: undefined,
    _endDate: undefined,
    _iterationMap: undefined,
    _iterationAcceptedMap: undefined,
    _iterationBlockedMap: undefined,
    _iterationTestCaseMap: undefined,

    items:[
        {
            xtype:'container',
            itemId:'header',
            cls:'header'
        },
        {
            xtype:'container',
            itemId:'bodyContainer',
            layout: {
		         type: 'vbox'
		    },
            height:'90%',
            width:'100%',
            autoScroll:true
        }
    ],


    launch: function() {
        //Write app code here

        //API Docs: https://help.rallydev.com/apps/2.1/doc/
        var context =  this.getContext();
        var project = context.getProject()['ObjectID'];
        var projectId = project;


        this.myMask = new Ext.LoadMask({
            msg: 'Please wait...',
            target: this
        });


        var searchButton = Ext.create('Rally.ui.Button', {
        	text: 'Search',
        	margin: '10 10 10 100',
        	scope: this,
        	handler: function() {
        		//handles search
        		//console.log(initDate, endDate);
        		this._doSearch(projectId, this._initDate, this._endDate);
        		//this._loadEndData(projectId, this._releaseId, null);
        	}
        });


        this.down('#header').add([
		{
			xtype: 'panel',
			autoWidth: true,
			height: 180,
			layout: 'hbox',

			items: [{
				xtype: 'panel',
				title: 'Choose date range:',
				//width: 450,
				//layout: 'fit',
				flex: 3,
				align: 'stretch',
				autoHeight: true,
				bodyPadding: 10,
				items: [{
					xtype: 'datefield',
					anchor: '100%',
			        fieldLabel: 'From',
					scope: this,
		        	listeners : {
		        		change: function(picker, newDate, oldDate) {
		        			this._initDate = newDate.toISOString();
		        		},
		        		scope:this
		        	}
				}, {
					xtype: 'datefield',
					anchor: '100%',
			        fieldLabel: 'To',
					scope: this,
		        	listeners : {
		        		change: function(picker, newDate, oldDate) {
		        			this._endDate = newDate;
		        		},
		        		scope:this
		        	}
				},
				searchButton]
			}]
		}]);
    },


    _doSearch: function(projectId, initDate, endDate) {
    	this.myMask.show();
    	this._getIterations(projectId, initDate, endDate);
    },


    _getIterations: function(projectId, initDate, endDate) {
    	var iterations;

    	Ext.create('Rally.data.wsapi.Store', {
            model: 'Iteration',
            autoLoad: true,
            fetch: ['Description', 
                'Name', 
                'ObjectID', 
                'PlannedVelocity', 
                'StartDate', 
                'EndDate', 
                'Project',
                'Theme',
                'Notes',
                'c_RetroActions',
                'c_RetroDeltas',
                'c_RetroPluses'],
            limit: Infinity,
            context: {
                projectScopeUp: false,
                projectScopeDown: true,
                project: null //null to search all workspace
            },


            filters: Rally.data.QueryFilter.and([
                Rally.data.QueryFilter.or([{
                    property: 'Project.parent.ObjectID',
                    value: projectId
                }, {
                    property: 'Project.parent.parent.ObjectID',
                    value: projectId
                }]),
                Rally.data.QueryFilter.and([{
                    property: 'StartDate',
                    operator: '>=',
                    value: initDate
                }, {
                    property: 'EndDate',
                    operator: '<=',
                    value: endDate
                }])        
            ]),

            listeners: {
                load: function(store, data, success) {
                    console.log('Iterations:', data);

                    var promises = [];
                    var promisesAcceptedOnDate = [];

                    this._iterationMap = new Ext.util.MixedCollection();
                    this._iterationAcceptedMap = new Ext.util.MixedCollection();
                    this._iterationBlockedMap = new Ext.util.MixedCollection();
                    this._iterationTestCaseMap = new Ext.util.MixedCollection();

                    _.each(data, function(record) {
                        //console.log('iteration: ', record);
                        this._iterationMap.add(record.get('ObjectID'), record);

                        promises.push(this._getStoriesByIteration(record));
                        promisesAcceptedOnDate.push(this._getStoriesAcceptedOnDate(record));
                    }, this);

                    var sayDoPromises = this._fetchSayDoFromLookback(data);

                    Deft.Promise.all(promisesAcceptedOnDate).then({
                        success: function(records) {
                            //create a map of iterationId/AcceptedOnDateScore
                            _.each(records, function(stories) {
                                if (stories.length > 0) {
                                    var iterationId = stories[0].get('Iteration').ObjectID;
                                    var iterationEndDate = this._iterationMap.get(iterationId).get('EndDate');

                                    this._iterationAcceptedMap.add(iterationId, this._calculateAcceptedScore(stories, iterationEndDate));

                                    this._iterationTestCaseMap.add(iterationId, this._calculateTestCasesAcceptance(stories));
                                }
                            }, this);

                            console.log('Accepted map:', this._iterationAcceptedMap);
                            console.log('TestCase map:', this._iterationTestCaseMap);


                            Deft.Promise.all(promises).then({
                                success: function(records) {
                                    //foreach story calculate velocity
                                    var rows = [];

                                    _.each(records, function(stories) {
                                        //console.log('stories: ', record);

                                        if (stories.length > 0) {
                                            rows.push(this._calculateVelocity(stories));
                                        }
                                    }, this);


                                    //for each story at end date get its own history
                                    var historyPromises = [];
                                    _.each(records, function(stories) {
                                        historyPromises.push(this._calculateAverageBlocked(stories));
                                      
                                    }, this);


                                    sayDoPromises.then({
                                        success: function(results) {
                                            console.log('end of sayDo promises:', results);
                                            _.each(rows, function(row) {
                                                // console.log('records:', results);
                                                // console.log('row iterationId:', row.iterationId);
                                                var sayDoRatio = Math.round(results[row.iterationId].count_ratio * 100) + '%';
                                                var deliveryScore = this._calculateDeliveryScore(results[row.iterationId].count_ratio);

                                                row['sayDoRatio'] = sayDoRatio;
                                                row['deliveryScore'] = deliveryScore;
                                            }, this);   


                                        },
                                        scope: this
                                    });

                                    Deft.Promise.all(historyPromises).then({
                                        success: function(records) {
                                            //console.log('all averages:', records);
                                            //console.log('blockedMap', this._iterationBlockedMap);


                                            this._iterationBlockedMap.eachKey(function(iterationId, blockedInfo) {
                                                _.each(rows, function(row) {
                                                    if (row.iterationId == iterationId) {
                                                        row['daysBlocked'] = blockedInfo['totalBlocked'];
                                                        row['averageDaysBlocked'] = blockedInfo['averageDaysBlocked'];
                                                        row['blockedAgingScore'] = blockedInfo['blockedAgingScore'];
                                                    }
                                                }, this);            
                                            }, 
                                            this);

                                            console.log('final rows:', rows);

                                            this._createGrid(rows);
                                        },
                                        scope: this
                                    });

                                },
                                scope: this
                            });
                        },
                        scope: this
                    });			        
                },
                scope: this
            }
        });


    	return iterations;
    },


    _calculateAverageBlocked: function(stories) {
        var deferred = Ext.create('Deft.Deferred');
        var blockedPromises = [];
        
        if (stories.length > 0) {
            var iterationId = stories[0].get('Iteration').ObjectID;

            _.each(stories, function(story) {
                blockedPromises.push(this._getDaysBlocked(story));
            }, this);


            Deft.Promise.all(blockedPromises).then({
                success: function(records) {
                    console.log('end of calculate average:', records);

                    //sum all blocked days:
                    var totalBlocked = 0;
                    _.each(records, function(daysBlocked) {
                        totalBlocked += daysBlocked;                  
                    }, this);

                    var averageDaysBlocked = Math.floor(totalBlocked / records.length);
                    var blockedAgingScore = 0;

                    switch(averageDaysBlocked) {
                        case 0:
                            blockedAgingScore = 5;
                            break;
                        case 1:
                            blockedAgingScore = 5;
                            break;
                        case 2:
                            blockedAgingScore = 4;
                            break;
                        case 3:
                            blockedAgingScore = 3;
                            break;
                        case 4:
                            blockedAgingScore = 1;
                            break;
                        case 5:
                            blockedAgingScore = 0;
                            break;
                        default:
                            blockedAgingScore = 0;
                    }

                    var blockedInfo = {
                        iterationId: iterationId,
                        totalBlocked: totalBlocked,
                        averageDaysBlocked: averageDaysBlocked,
                        blockedAgingScore: blockedAgingScore
                    };

                    this._iterationBlockedMap.add(iterationId, blockedInfo);

                    deferred.resolve(blockedInfo);
                },
                scope: this
            });
        } else {
            deferred.resolve();
        }

        return deferred.promise;
    },


    _getDaysBlocked: function(story) {
        // console.log('looking for Story history', story);

        var deferred = Ext.create('Deft.Deferred');

        var objectId = story.get('ObjectID');
        // var iterationId = story.get('Iteration').ObjectID;
        var endDate = story.get('_ValidTo');

        var filterEnd = [
            {
                property : '_TypeHierarchy',
                operator : 'in',
                value    : ["HierarchicalRequirement", 'Defect', 'TestSet']
            },
            {
                property : 'ObjectID',
                value    : objectId
            },
            {
                property : '_ValidTo',
                operator : '<=',
                value : endDate
            }
        ];


        //console.log('filters:', filterEnd);

        var store = Ext.create('Rally.data.lookback.SnapshotStore', {
            fetch : ['Name', 
                'FormattedID', 
                'Project',
                'Blocked',
                'Iteration',
                "_ValidFrom", 
                "_ValidTo"],
            // filters : this.filtersInit,
            filters : filterEnd,
            autoLoad: true,
            sorters: [{
                property: '_ValidTo',
                direction: 'ASC'
            }],
            limit: Infinity,
            compress: true,
            hydrate: ['Iteration', 'Project'],

            listeners: {
                load: function(store, data, success) {
                    //console.log('history data', data);
                    var daysBlocked = this._calculateDaysBlocked(data);
                    // console.log('days blocked for this story:', daysBlocked);
                    deferred.resolve(daysBlocked);
                },
                scope: this
            }
        });

        return deferred.promise;
    },


    _calculateDaysBlocked: function(storyHistory) {
        var startDate;
        var endDate;
        var blocked = false;
        var timeBlocked = 0;

        for (var i = 0; i < storyHistory.length; i++) {
            var story = storyHistory[i];

            if (story.get('Blocked')) {
                blocked = true;
                var from = story.get('_ValidFrom');
                var to = story.get('_ValidTo');

                var currentDate = new Date();
                startDate = new Date(from);
                endDate = new Date(to);

                if (endDate > currentDate) {
                    // console.log('endDate > currentDate', endDate);
                    // var timeInMilis = currentDate.getTime();

                    timeBlocked += this._getDifferenceInMilis(startDate, currentDate);
                } else {
                    // var timeInMilis = endDate.getTime();

                    timeBlocked += this._getDifferenceInMilis(startDate, endDate);
                }

                // console.log('start date of blocked story:', startDate, timeInMilis);

                // console.log('end of blocked', endDate, timeInMilis);
                // console.log('end difference in milis', this._getDifferenceInMilis(startDate, endDate));
                // console.log('end difference in days ', Math.floor(timeBlocked / (24*60*60*1000)));
            }
        }

        return Math.floor(timeBlocked / (24*60*60*1000));
    },

    _calculateDeliveryScore: function(sayDoRatio) {
        var score = 0;

        if (sayDoRatio >= 0.9) {
            score = 5;
        } else if (sayDoRatio >= 0.8) {
            score = 3;
        } else {
            score = 0;
        }

        return score;
    },


    _getDifferenceInMilis: function(startDate, endDate) {

        var sDate = new Date(startDate);
        var sTimeInMilis = sDate.getTime();

        var eDate = new Date(endDate);
        var eTimeInMilis = eDate.getTime();

        return eTimeInMilis - sTimeInMilis;
    },


    _getStoriesByIteration: function(iteration) {

        var deferred = Ext.create('Deft.Deferred');
        var iterationId = iteration.get('ObjectID');
        var endDate = iteration.get('EndDate');
        var projectId = iteration.get('Project').ObjectID;

        this._showStatus("Loading Stories for iteration:" + iterationId);

    	var filterEnd = [
    		{
                property : '__At',
                value    : endDate
            },
            
            {
                property : '_TypeHierarchy',
                operator : 'in',
                value    : [ "Defect", "HierarchicalRequirement", "TestSet"]
            },
           	{
                property : '_ProjectHierarchy',
                value: projectId
            },
            {
            	property : 'Iteration',
            	value : iterationId
            }//,
            // {
            //     property : 'ScheduleState',
            //     operator : 'in',
            //     value    : [ "Accepted", "Ready to Ship"]
            // }
    	];


        //console.log('filters:', filterEnd);

        var store = Ext.create('Rally.data.lookback.SnapshotStore', {
            fetch : ['Name', 
                'FormattedID', 
                'PlanEstimate', 
                'ScheduleState',
                'State', 
                'Project',
                'Iteration',
                "_ValidFrom", 
                "_ValidTo"],
            // filters : this.filtersInit,
            filters : filterEnd,
            autoLoad: true,
            sorters: [{
                property: 'ObjectID',
                direction: 'ASC'
            }],
            limit: Infinity,
            hydrate: ["State", 'Iteration', "ScheduleState", 'Project'],

            listeners: {
                load: function(store, data, success) {
                	deferred.resolve(data);
                	console.log('stories data', data);
                	//this._loadEndData();
                },
                scope: this
            }
        });

        return deferred.promise;
    },


    _getStoriesAcceptedOnDate: function(iteration) {
        var iterationId = iteration.get('ObjectID');
        // console.log('looking for stories at iteration:', iterationId);
        this._showStatus("Loading Stories for Checking engaging of PO.");

        var deferred = Ext.create('Deft.Deferred');

        Ext.create('Rally.data.wsapi.artifact.Store', {
            models: ['Defect', 'UserStory', 'TestSet'],
            autoLoad: true,
            fetch: ['Name', 'ObjectID', 'FormattedID', 'AcceptedDate', 'Iteration', 'TestCases', 'InProgressDate'],
            context: {
                projectScopeUp: false,
                projectScopeDown: true,
                project: null //null to search all workspace
            },
            filters: [{
                property: 'Iteration.ObjectID',
                value: iterationId
            }],
            limit: Infinity,
            listeners: {
                load: function(store, data, success) {
                    // console.log('Stories for accepted:', data);
                    var testCasesPromises = [];

                    if (data && data.length >0) {
                        _.each(data, function(story) {
                            var testCasesStore = story.getCollection('TestCases');

                            var promise = testCasesStore.load({
                                fetch: ['FormattedID', 'Name', 'CreationDate']
                            });

                            testCasesPromises.push(promise);
                            story.testCasesStore = testCasesStore;  //save reference for later
                        }, this);

                        Deft.Promise.all(testCasesPromises).then({
                            success: function(records) {
                                //all stories now have their test cases loaded
                                //console.log('records of promise', records);
                                //console.log('stories with testcases:', data);

                                deferred.resolve(data);
                            },
                            scope: this
                        });                        
                    } else {
                        deferred.resolve(data);                        
                    }

                }
            }, scope: this
        });

        return deferred.promise;
    },


    _calculateVelocity: function(stories) {
    	var row = {};

        if (stories && stories.length > 0) {
	    	var actualVelocity = 0;
	    	_.each(stories, function(record) {
	    		if (record.get('ScheduleState') == 'Accepted' || record.get('ScheduleState') == 'Ready to Ship') {
	        		actualVelocity += record.get('PlanEstimate');
	        	}
	        }, this);

	    	var iterationName = stories[0].get('Iteration').Name;
	    	var iterationId = stories[0].get('Iteration').ObjectID;
	    	var plannedVelocity = this._iterationMap.get(iterationId).get('PlannedVelocity');

            var objectivesScore = this._calculateObjectivesScore(iterationId);
            var externalDeltasScore = this._calculateExternalDeltasScore(iterationId);
            var retrospectivesScore = this._calculateRetrospectivesScore(iterationId);

	    	var percentDone;
	    	if (plannedVelocity) {
	    		percentDone = Math.round(actualVelocity / plannedVelocity * 100) + '%';
	    	} else {
	    		percentDone = 'PlannedVelocity empty';
	    	}

	    	var velocityScore = this._calculateVelocityScore(actualVelocity, plannedVelocity);
            var acceptedScore = this._iterationAcceptedMap.get(iterationId);
            var testCaseScore = this._iterationTestCaseMap.get(iterationId);

	    	row = {
	    		iteration : iterationName,
	    		iterationId : iterationId,
		        project : stories[0].get('Project').Name,
		        actualVelocity : actualVelocity,
		        plannedVelocity : plannedVelocity,
		        percentDone : percentDone,
		        velocityScore : velocityScore,
                acceptedScore: acceptedScore,
                objectivesScore: objectivesScore,
                externalDeltasScore: externalDeltasScore,
                retrospectivesScore: retrospectivesScore,
                testCaseScore: testCaseScore
	    	};       
	    }

	    return row;
    },


    _calculateTestCasesAcceptance: function(stories) {
        var score = 0;
        if (stories && stories.length > 0) {
            _.each(stories, function(story) {
                var inProgressDate = story.get('InProgressDate');

                var testCases = story.testCasesStore.data;

                // console.log('InProgressDate:', inProgressDate);
                // console.log('testCases:', testCases);

                testCases.eachKey(function(testCaseExtId, testCase) {
                    var testCaseCreationDate = testCase.get('CreationDate');
                    // console.log('testCase', testCase);
                    // console.log('creation date TC', testCaseCreationDate);

                    if (testCaseCreationDate < inProgressDate) {
                        score = 5;
                    }
                    
                }, this); 
            }, this);
        }

        return score;
    },


    _calculateObjectivesScore: function(iterationId) {
        var theme = this._iterationMap.get(iterationId).get('Theme');
        //console.log('theme of iteration', iterationId, theme);

        if (theme) {
            return 5;
        } else {
            return 0;
        }
    },


    _calculateExternalDeltasScore: function(iterationId) {
        var notes = this._iterationMap.get(iterationId).get('Notes');
        //console.log('notes of iteration', iterationId, theme);

        if (notes) {
            return 5;
        } else {
            return 0;
        }
    },


    _calculateRetrospectivesScore: function(iterationId) {
        var retroPlus = this._iterationMap.get(iterationId).get('c_RetroPluses');
        var retroAction = this._iterationMap.get(iterationId).get('c_RetroActions');
        var retroDelta = this._iterationMap.get(iterationId).get('c_RetroDeltas');
        //console.log('retros of iteration', iterationId, retroPlus, retroAction, retroDelta);

        if (retroPlus && retroAction && retroDelta) {
            return 5;
        } else {
            return 0;
        }
    },


    _calculateVelocityScore: function(actualVelocity, plannedVelocity) {
    	if (!plannedVelocity) {
    		return 0;
    	}

    	var percent = Math.round(actualVelocity / plannedVelocity * 100);

    	if (percent >= 100) {
    		return 5;
    	} else if (percent >= 90) {
    		return 4;
    	} else if (percent >= 80) {
    		return 3;
    	} else if (percent >= 70) {
    		return 2;
    	} else {
    		return 0;
    	}
    },


    _calculateAcceptedScore: function(stories, iterationEndDate) {
        //console.log('cheking accepted on iteration end', stories, iterationEndDate );
        var score = 0;

        var acceptedWithinRange = 0;
        _.each(stories, function(story) {
            //console.log('stories: ', record);

            if (this._isAcceptedWithinRange(story, iterationEndDate)) {
                acceptedWithinRange += 1;
            }

        }, this);

        if (acceptedWithinRange > (stories.length / 2)) {
            score = 5;
        } else {
            score = 0;
        }

        return score;
    },


    _isAcceptedWithinRange: function(story, endDate) {
        // console.log('Iteration endDate:', endDate);

        var acceptedLimit = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - 2);

        // console.log('startLimit', startLimit);

        var acceptedDate = story.get('AcceptedDate');
        //console.log('acceptedDate:', acceptedDate);

        if (acceptedDate > acceptedLimit) {
            //console.log('acceptedDate out');
            return false;
        } else {
            // console.log('acceptedDate in');
            return true;
        }
    },


    _showStatus: function(message) {
        if (message) {
            Rally.ui.notify.Notifier.showStatus({
                message: message,
                showForever: false,
                closable: false,
                animateShowHide: false
            });
        } else {
            Rally.ui.notify.Notifier.hide();
        }
    },


    _fetchSayDoFromLookback: function(iterationRecords) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        
        if (iterationRecords.length === 0) {
            return [];
        }

        this._showStatus("Loading Iteration Say/Do Data");

        var promises = [];
        Ext.Array.each(iterationRecords, function(iteration){
            var start = new Date(iteration.get("StartDate").setHours(23,59,59));
            var end = iteration.get("EndDate");
            var oid = iteration.get("ObjectID");
            
            promises.push(function() { return me._fetchSayDoForIteration(oid,start,end); });
        });
        
        Deft.Chain.sequence(promises,me).then({
            success: function(results) {
                var say_do_by_iteration_oid = {};
                Ext.Array.each(results, function(result){
                    Ext.Object.merge(say_do_by_iteration_oid, result);
                });

                console.log('say do ratio by iteration:', say_do_by_iteration_oid);
                
                deferred.resolve(say_do_by_iteration_oid);
            },

            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        return deferred.promise;
    },

    _fetchSayDoForIteration: function(oid,start,end) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        
        var promises = [
            function() { return me._fetchSayDoForStartOfIteration(oid,start,end); },
            function() { return me._fetchSayDoForEndOfIteration(oid,start,end); }
        ];
        
        Deft.Chain.sequence(promises,me).then({
            success: function(results) {
                var start_items = results[0];
                var end_items = results[1];
                
                var start_items_by_formatted_id = {};
                var count_start = 0;
                var size_start  = 0;
                
                Ext.Array.each(start_items, function(item) {
                    var fid = item.get('FormattedID');
                    var pe  = item.get('PlanEstimate') || 0;
                    
                    start_items_by_formatted_id[fid] = item;
                    count_start = count_start + 1;
                    size_start  = size_start + pe;
                });
                
                var analysis = {
                    items: [],
                    count_start: count_start,
                    size_start:  size_start,
                    count_end: 0,
                    size_end:  0,
                    count_ratio: -1,
                    size_ratio:  -1
                };
                
                Ext.Array.each(end_items, function(item){
                    var fid = item.get('FormattedID');
                    var start_item = start_items_by_formatted_id[fid];
                    
                    if ( Ext.isEmpty(start_item) ) { 
                        console.log("Not in the start: ", fid);
                    } else if ( Ext.isEmpty(item.get('AcceptedDate')) ) {
                        console.log("Not Accepted: ", fid);
                    } else {
                        start_item.set('__end_plan_estimate', pe);
                        var pe  = start_item.get('PlanEstimate') || 0;
                        
                        analysis.count_end = analysis.count_end + 1;
                        analysis.size_end  = analysis.size_end + pe;
                    }
                });
                
                analysis.items = Ext.Array.map(Ext.Object.getValues(start_items_by_formatted_id), function(item) { return item; });
                
                
                if ( analysis.count_start > 0 ) {
                    analysis.count_ratio = analysis.count_end / analysis.count_start;
                }
                if ( analysis.size_start > 0 ) {
                    analysis.size_ratio = analysis.size_end / analysis.size_start;
                }
                
                var x = {}; 
                x[oid] = analysis;
                deferred.resolve(x);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        
        return deferred.promise;
    },

    
    _fetchSayDoForStartOfIteration: function(oid,start,end) {
        var date_filters = Rally.data.lookback.QueryFilter.or([
            {property:'__At',value: Rally.util.DateTime.toIsoString(start)}
        ]);
        
        var iteration_filter = Rally.data.lookback.QueryFilter.and([{property:'Iteration',value:oid}]);
        
        var config = {
            fetch: ['FormattedID','Name','AcceptedDate','PlanEstimate'],
            filters: date_filters.and(iteration_filter)
        };
        
        var lookback_store_class = "Rally.data.lookback.SnapshotStore";
        
        return this._fetchData(lookback_store_class, config);
    },

    
    _fetchSayDoForEndOfIteration: function(oid,start,end) {        
        var date_filters = Rally.data.lookback.QueryFilter.or([
            {property:'__At',value: Rally.util.DateTime.toIsoString(end)}
        ]);
        
        var iteration_filter = Rally.data.lookback.QueryFilter.and([{property:'Iteration',value:oid}]);
        
        var config = {
            fetch: ['FormattedID','Name','AcceptedDate','PlanEstimate'],
            filters: date_filters.and(iteration_filter)
        };
        
        var lookback_store_class = "Rally.data.lookback.SnapshotStore";
        
        return this._fetchData(lookback_store_class, config);
    },


    _fetchData: function(storeType, config){
        // console.log('config', config);
        var deferred = Ext.create('Deft.Deferred');

        Ext.create(storeType,config).load({
            callback: function(records, operation){

                if (operation.wasSuccessful()) {
                    deferred.resolve(records);
                } else {
                    deferred.resolve('Error fetching data: ' + operation.error.errors.join(','));
                }
            },
            scope: this
        });
        return deferred;
    },


    _createGrid: function(rows) {
    	this.down('#bodyContainer').removeAll(true);    	

    	var store = Ext.create('Rally.data.custom.Store', {
            data: rows,
            pageSize: 1000
        });

        var exportButton = Ext.create('Rally.ui.Button', {
        	text: 'Export',
        	margin: '10 10 10 10',
        	scope: this,
        	handler: function() {
        		var csv = this._convertToCSV(rows);
        		console.log('converting to csv:', csv);


        		//Download the file as CSV
		        var downloadLink = document.createElement("a");
		        var blob = new Blob(["\ufeff", csv]);
		        var url = URL.createObjectURL(blob);
		        downloadLink.href = url;
		        downloadLink.download = "report.csv";  //Name the file here
		        document.body.appendChild(downloadLink);
		        downloadLink.click();
		        document.body.removeChild(downloadLink);
        	}
        });
        

    	var grid = Ext.create('Rally.ui.grid.Grid', {
    		width: 1600,
			viewConfig: {
				stripeRows: true,
				enableTextSelection: true
			},
			showRowActionsColumn: false,
			showPagingToolbar: false,
			enableEditing: false,
    		itemId : 'iterationScoreGrid',
    		store: store,

    		columnCfgs: [
                {
                    text: 'Iteration',
                    dataIndex: 'iteration',
                    flex: 2
                },
                {
                    text: 'Project',
                    dataIndex: 'project',
                    flex: 3
                },
                {
                    text: 'Percent Done',
                    dataIndex: 'percentDone',
                    flex: 1
                },
                {
                    text: 'Velocity Score', 
                    dataIndex: 'velocityScore',
                    flex: 1
                },
                {
                    text: 'PO Engaged', 
                    dataIndex: 'acceptedScore',
                    flex: 1
                },
                {
                    text: 'Days Blocked', 
                    dataIndex: 'daysBlocked',
                    flex: 2
                },
                {
                    text: 'Average Days Blocked', 
                    dataIndex: 'averageDaysBlocked',
                    flex: 2
                },
                {
                    text: 'Blocked Aging Score', 
                    dataIndex: 'blockedAgingScore',
                    flex: 2
                },
                {
                    text: 'Objectives Score', 
                    dataIndex: 'objectivesScore',
                    flex: 2
                },
                {
                    text: 'External Deltas Score', 
                    dataIndex: 'externalDeltasScore',
                    flex: 2
                },
                {
                    text: 'Retrospectives Score',
                    dataIndex: 'retrospectivesScore',
                    flex: 2
                },
                {
                    text: 'TestCase Score',
                    dataIndex: 'testCaseScore',
                    flex: 2
                },
                {
                    text: 'Say Do Ratio',
                    dataIndex: 'sayDoRatio',
                    flex: 2
                },
                {
                    text: 'Delivery Score',
                    dataIndex: 'deliveryScore',
                    flex: 2
                }
            ]
        });

		var mainPanel = Ext.create('Ext.panel.Panel', {
			title: 'Iteration Adherence Score',			
			autoScroll: true,
            layout: {
				type: 'vbox',
				align: 'stretch',
				padding: 5
			},
            padding: 5,            
            items: [
                grid
            ]
        });

		this.down('#bodyContainer').add(exportButton);
		this.down('#bodyContainer').add(mainPanel);

		this.myMask.hide();
    },


   	_convertToCSV: function(objArray) {
		var fields = Object.keys(objArray[0]);

		var replacer = function(key, value) { return value === null ? '' : value; };
		var csv = objArray.map(function(row){
		  return fields.map(function(fieldName) {
		    return JSON.stringify(row[fieldName], replacer);
		  }).join(',');
		});

		csv.unshift(fields.join(',')); // add header column

		//console.log(csv.join('\r\n'));

		return csv.join('\r\n');
    }

});
