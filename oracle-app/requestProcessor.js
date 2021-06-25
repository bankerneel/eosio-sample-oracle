/*
 * This module is used for performing requests and sending responses to oracle contract
 */

const fetch = require('node-fetch');
var async = require("async");
var jp = require('jsonpath');

const ResponseTypes = require('./responseType');
const encode = require('./encoding');
const aggregate = require ('./aggregate')
var moment = require('moment')
var responseJson = require('./response.json')
var aggregationJson = require('./aggregation.json')
/*
 * Checks if value has expected type and return it
 * Otherwise return null
 */
function checkType(value, response_type) {
	console.log("request processor, inside checkType value : ", value, " typeof value :", typeof value )

	if (response_type == ResponseTypes.Bool) {

			console.log("boolean")
			return value;
	}
	else if (response_type == ResponseTypes.Int) {
		if (typeof value === 'number'  &&
			value >= -2147483648 && value <= 2147483647) {
			value = Number.parseInt(value);
			console.log("int-------------", value)
			return value;

		}
	}
	else if (response_type == ResponseTypes.Double) {
		if (typeof value === 'number') {
			console.log("value is parsed to float--------")
			value = Number.parseFloat(value);
			return value;
		}
	}
	else if (response_type == ResponseTypes.String) {
		if (typeof value === 'string'&& value.length <= 127 || typeof value === 'number' ) {
			console.log("string")
			return value;
		}
	}
	else return null;

}

/*
	Used to Parse value from json using path
 	path is string of json fields separated with '\n' required to obtain value from json
	Ex:
	{
		"foo": { "bar": 1 },
		“Arr”: [ “Key1” : “99.666”, “Key2” : 99.556 ] 
	}
	To parse value of the key “bar” from given json response, json_field path will look like: "foo.bar".
	To parse value of “Key2” from the array “Arr”, json_field will look like : “Arr[0].Key2”.
	
*/
function getValueFromJson(json, path) {

	console.log("inside getValueFromJson, json", json)
	console.log("inside getValueFromJson, path", path)
	var needed_field = jp.query(json, '$.' + path)
	console.log("inside getvaluefromjson, needed_field", needed_field);
	console.log("inside getvaluefromjson needed_field[0]", needed_field[0]);
	return needed_field[0];


}


class RequestProcessor {

	constructor(options) {
		this.numRetries = 1;
	}

	/*
	 * Stores the data in database for audit trail,
	 * called after processing each oracle request.  
     */

	async audit_trail (id, caller, api, response_type, aggregation_type,  aggregated_response, context,  options, assigned_oracle, standby_oracle){

		console.log("request processor, inside audit_trail  :", options.ala_data.oracle_account)
		console.log("request processor, inside audit_trail  :", assigned_oracle)
		console.log("request processor, inside audit_trail  :", standby_oracle)
		console.log("request processor, inside audit_trail  :", (options.ala_data.oracle_contract_name == assigned_oracle))


		response_type = "" + response_type; 
		aggregation_type = "" + aggregation_type; 

		response_type = responseJson[response_type]; 
		aggregation_type = aggregationJson[aggregation_type]; 

		if (options.ala_data.oracle_account == assigned_oracle || options.ala_data.oracle_account == standby_oracle){

			context.mongo.model('audit_trail').findOne({request_id: id}).then(function (userDataa) {
				console.log("Moment of truth", userDataa)
				if(userDataa == null){
					context.mongo.model('audit_trail').create({ 
						caller: caller, 
						request_id: id, 
						time: moment().format('YYYY-MM-DD hh:mm:ss'),
						api_set : api,
						response_type : response_type,
						aggregation_type : aggregation_type,
						oracle_account : assigned_oracle, 
						aggregated_response: aggregated_response
					
					}).catch(error => {
						console.error('Failed to insert response to mongo3: ', error);
					});
				}
			})		
		}
		
	}

	/*
     * Executes requests to provided apis and returns an aggregation of results
     * In case request url is localhost (or 127.0.0.1)
     * or error was encountered during request processing api will be considered as failed
     */

	async processRequest(id, caller, apis, response_type, aggregation_type, context, prefered_api, string_to_count, options, assigned_oracle, standby_oracle) {

		
		var results = [];
		var api_response_set = [];
		for (var api of apis) {
			var result = null;
			if (api.endpoint.match(/^(https:\/\/)?(localhost|127\.0\.0\.1)/) === null) {
				try {
					result = await this.getResult(api, api.endpoint, api.json_field, response_type);
					console.log("request processor, inside processReq result :", result)
					
					if (result !== null) {
						api["response"] = result;
						api["api"] = api['endpoint'];
						delete api['endpoint'];
						api_response_set.push(api);
						results.push(result);
					}
						
				}
				catch (e) {
					console.error(e);
				}
			}
			else {
				console.log('Skipping request to localhost.');
			}
		}


		var confirmed_response = results.filter((value,index,arr)=>{
			return value!=undefined
		})
	
		
		console.log("request processor, inside processReq confirmed_response.length :", confirmed_response.length)
		console.log("request processor, inside processReq apis.length/2  :", apis.length/2)
		console.log("request processor, inside processReq confirmed_response.length>=apis.length/2  :", (confirmed_response.length>=apis.length/2) )
		console.log("request processor, inside processReq results[prefered_api] :", results[prefered_api])


		if(confirmed_response.length>=apis.length/2 )
		{
			result = aggregate (confirmed_response, aggregation_type, string_to_count)
		}
		else if(prefered_api)
		{
			console.log("prefered_api: ~~~~~~~~~~",prefered_api);
			if(results[prefered_api])
			{
				result = results[prefered_api];
			}
			else
			{
				result = aggregate (confirmed_response, aggregation_type, string_to_count)
			}
		}
		else
		{
			result = aggregate (confirmed_response, aggregation_type, string_to_count)
		}
		
		var encoded = "";
		try {
			console.log("request processor, inside processReq before encodeing aggregation  :", result)
			encoded = encode(result, response_type);
		}
		catch (e) {
			console.error(e);
		}
	
		console.log("request processor, inside processReq encoded :", encoded)
		console.log("apaiaapapiapiaiapaipapapia", api_response_set)
		console.log("apaiaapapiapiaiapaipapapia", result)

		await this.audit_trail(id, caller, api_response_set, response_type, aggregation_type, result, context,  options, assigned_oracle, standby_oracle );


		return encoded;
	}

	/*
     * Executes request and returns value of valid type
     * If error occurred returns null
     */
	async getResult(set, endpoint, json_field, response_type) {
		
		var res = await this.makeRequest(endpoint, json_field);
		console.log("request processor, inside getResult res:", res)
		return checkType(res, response_type);
	}

	/*
     * Executes request (on fail <numRetries> retries is done)
     * and returns value parsed from json
     */
	async makeRequest(endpoint, json_field) {
		var res = null;
		try {
			res = await fetch(endpoint);
		}
		catch (e) {
			console.error(e);
		}
		var retries = this.numRetries;
		while ((!res || !res.ok) && retries > 0) {
			console.log("\nRetrying request...");
			try {
				res = await fetch(endpoint);
			}
			catch (e) {
				console.error(e);
			}
			retries -= 1;
		}
		if (!res || !res.ok) {
			return null;
		}

		const json = await res.json();
		return getValueFromJson(json, json_field);
	}

}


module.exports = RequestProcessor;