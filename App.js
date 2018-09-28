Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',


    _initDate: undefined,
    _endDate: undefined,
    _iterationMap: undefined,
    _iterationAcceptedMap: undefined,

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
            fetch: ['Description', 'Name', 'ObjectID', 'PlannedVelocity', 'StartDate', 'EndDate', 'Project'],
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
                    //console.log('Data:', data);

                    var promises = [];
                    var promisesAcceptedOnDate = [];

                    this._iterationMap = new Ext.util.MixedCollection();
                    this._iterationAcceptedMap = new Ext.util.MixedCollection();

                    _.each(data, function(record) {
                        //console.log('iteration: ', record);
                        this._iterationMap.add(record.get('ObjectID'), record);

                        promises.push(this._getStoriesByIteration(record));
                        promisesAcceptedOnDate.push(this._getStoriesAcceptedOnDate(record));
                    }, this);


                    Deft.Promise.all(promisesAcceptedOnDate).then({
                        success: function(records) {
                            //create a map of iterationId/AcceptedOnDateScore
                            _.each(records, function(stories) {
                                if (stories.length > 0) {
                                    var iterationId = stories[0].get('Iteration').ObjectID;
                                    var iterationEndDate = this._iterationMap.get(iterationId).get('EndDate');

                                    this._iterationAcceptedMap.add(iterationId, this._calculateAcceptedScore(stories, iterationEndDate));
                                }

                            }, this);

                            console.log('Accepted map:', this._iterationAcceptedMap);

                        },
                        scope: this
                    });


			        Deft.Promise.all(promises).then({
			        	success: function(records) {
			        		//foreach iteration calculate velocity
			        		var rows = [];

			        		_.each(records, function(record) {
		                    	//console.log('stories: ', record);

		                    	if (record.length > 0) {
		                    		rows.push(this._calculateVelocity(record));
		                    	}

					        }, this);

					        //console.log('rows:', rows);

					        this._createGrid(rows);
			        	},
                        scope: this
			        });

                },
                scope: this
            }
        });


    	return iterations;
    },


    _getStoriesByIteration: function(iteration) {
    	var deferred = Ext.create('Deft.Deferred');
    	var iterationId = iteration.get('ObjectID');
    	var endDate = iteration.get('EndDate');
    	var projectId = iteration.get('Project').ObjectID;

    	var filterEnd = [
    		{
                property : '__At',
                value    : endDate
            },
            
            {
                property : '_TypeHierarchy',
                operator : 'in',
                value    : [ "Defect", "HierarchicalRequirement"]
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
                	//console.log('Init data', data);
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

        var parentNames = new Ext.util.MixedCollection();
        var deferred = Ext.create('Deft.Deferred');

        Ext.create('Rally.data.wsapi.Store', {
            model: 'HierarchicalRequirement',
            autoLoad: true,
            fetch: ['Name', 'ObjectID', 'FormattedID', 'AcceptedDate', 'Iteration'],
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
                    // console.log('Stories for accedpted:', data);
                    deferred.resolve(data);
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

	    	var percentDone;
	    	if (plannedVelocity) {
	    		percentDone = Math.round(actualVelocity / plannedVelocity * 100) + '%';
	    	} else {
	    		percentDone = 'PlannedVelocity empty';
	    	}

	    	var score = this._calculateScore(actualVelocity, plannedVelocity);
            var acceptedScore = this._iterationAcceptedMap.get(iterationId);

	    	row = {
	    		iteration : iterationName,
	    		iterationId : iterationId,
		        project : stories[0].get('Project').Name,
		        actualVelocity : actualVelocity,
		        plannedVelocity : plannedVelocity,
		        percentDone : percentDone,
		        score : score,
                acceptedScore: acceptedScore
	    	};       
	    }

	    return row;
    },


    _calculateScore: function(actualVelocity, plannedVelocity) {
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
    		width: 880,
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
                    dataIndex: 'score',
                    flex: 1
                },
                {
                    text: 'PO Engaged', 
                    dataIndex: 'acceptedScore',
                    flex: 1
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
