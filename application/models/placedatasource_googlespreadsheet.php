<?php if ( ! defined('BASEPATH')) exit('No direct script access allowed');
class PlaceDataSource_GoogleSpreadsheet extends PlaceDataSource {

var $table            = 'placedatasources';
var $default_order_by = array('name');
var $has_one          = array();
var $has_many         = array('place',);

var $option_fields = array(
    'url'     => array('required'=>TRUE, 'isfield'=>FALSE, 'name'=>"Spreadsheet URL", 'help'=>'The URL of the Google Drive spreadsheet.<br/>Example: <a target="_blank" href="https://docs.google.com/spreadsheets/d/1e4rbpYv8KNAKrsCilHcxjaqhtpx4osgfYRAtqNCp0fI/pubhtml">https://docs.google.com/spreadsheets/d/1e4rbpYv8KNAKrsCilHcxjaqhtpx4osgfYRAtqNCp0fI/pubhtml</a><br/>The spreadsheet must be <i>Published to the web</i>. Note that &quot;Published to the web&quot; and &quot;Public on the web&quot; are not the same thing.'),
    'option1' => array('required'=>TRUE, 'isfield'=>TRUE, 'name'=>"Name/Title Field", 'help'=>"Which field contains the name/title for these locations?"),
    'option2' => array('required'=>TRUE, 'isfield'=>TRUE, 'name'=>"Description Field", 'help'=>"Which field contains the description for these locations?"),
    'option3' => array('required'=>TRUE, 'isfield'=>TRUE, 'name'=>"Latitude Field", 'help'=>"Which field has the latitude of this location?"),
    'option4' => array('required'=>TRUE, 'isfield'=>TRUE, 'name'=>"Longitude Field", 'help'=>"Which field has the longitude of this location?"),
    'option5' => array('required'=>FALSE, 'isfield'=>TRUE, 'name'=>"URL Field", 'help'=>"Which field contains a URL where one can get info about each place?"),
    'option6' => array('required'=>FALSE, 'isfield'=>FALSE, 'name'=>"URL Button Text", 'help'=>"For the mobile app, what text appears in the &quot;Go to website&quot; button? Only applicable if you choose an URL Field option.", 'maxlength'=>15, 'default'=>"Website"),
    'option7' => array('required'=>FALSE, 'isfield'=>TRUE, 'name'=>"URL Field (More Info)", 'help'=>"Like URL Field above, but a second website. Useful if a second site has hours, events, or tickets."),
    'option8' => array('required'=>FALSE, 'isfield'=>FALSE, 'name'=>"URL Button Text", 'help'=>"Like the URL Button Text above, but this text applies to the More Info button. Only applicable if you pick a second URL Field above for More Info.", 'maxlength'=>15, 'default'=>"More Info"),
    'option9' => NULL,
);


public function __construct() {
    parent::__construct();

    // assign a default WHERE clause; this is effectively chained to any other activerecord clause that is later added
    // and thus acts as an implicit filter
    $this->where('type','Google Spreadsheet');
}


/**********************************************************************************************
 * INSTANCE METHODS
 **********************************************************************************************/

/*
 * reloadContent()
 * Connect to the data source and grab all the events listed, and save them as local Places.
 * By design this is destructive: all existing Places for this PlaceDataSource are deleted in favor of this comprehensive list of places.
 *
 * This method throws an Exception in any case, either a PlaceDataSourceErrorException or PlaceDataSourceSuccessException
 * This allows for more complex communication than a simple true/false return, e.g. the name of the data source and an error code (number of placed loaded/failed)
 */
public function reloadContent() {
    // grok the table key from the URL given; be strict about the URL, making sure it's really over at Google Docs
    // but also handle the ever-growing variety of URLs; the beauty of standards, right?  :)
    $tablekey = null;
    preg_match('!https://docs.google.com/spreadsheet/\w+/?\?key=([\w\_\-]+)!i', $this->url, $tablekey );
    if (! $tablekey) {
        preg_match('!https://docs.google.com/spreadsheets/\w+/([\w\_\-]+)/pubhtml!i', $this->url, $tablekey );
    }
    $tablekey = @$tablekey[1];
    if (! $tablekey) throw new PlaceDataSourceErrorException( array("That URL does not appear to point to a Google Drive Spreadsheet.") );

    // check that the Name and Description and Lat & Lon fields, are all represented
    // why check when they had to pick from a list? cuz the spreadsheet may have changed since they set those options, or maybe they "hacked" and submitted some invalid field name
    $namefield      = $this->option1;
    $descfield      = $this->option2;
    $latfield       = $this->option3;
    $lonfield       = $this->option4;
    $urlfield       = $this->option5;
    $urltext        = $this->option6;
    $urlfield2      = $this->option7;
    $urltext2       = $this->option8;
    if (! $namefield) throw new PlaceDataSourceErrorException( array('Blank or invalid field: Name field') );
    if (! $latfield)  throw new PlaceDataSourceErrorException( array('Blank or invalid field: Latitude field') );
    if (! $lonfield)  throw new PlaceDataSourceErrorException( array('Blank or invalid field: Longitude field') );
    $fields = $this->listFields(TRUE);
    if (!in_array($namefield,$fields)) throw new PlaceDataSourceErrorException( array('Chosen Name field ($namefield) does not exist in the spreadsheet.') );
    if (!in_array($latfield,$fields))  throw new PlaceDataSourceErrorException( array('Chosen Latitude field ($latfield) does not exist in the spreadsheet.') );
    if (!in_array($lonfield,$fields))  throw new PlaceDataSourceErrorException( array('Chosen Longitude field ($lonfield) does not exist in the spreadsheet.') );
    if ($descfield and !in_array($descfield,$fields)) throw new PlaceDataSourceErrorException( array('Chosen Description field ($descfield) does not exist in the spreadsheet.') );
    if ($urlfield  and !in_array($urlfield,$fields))  throw new PlaceDataSourceErrorException( array('Chosen URL field ($urlfield) does not exist in the spreadsheet.') );
    if ($urlfield2 and !in_array($urlfield2,$fields)) throw new PlaceDataSourceErrorException( array('Chosen More Info URL field ($urlfield) does not exist in the spreadsheet.') );

    // compose the URL and fetch the spreadsheet content
    // then check for nonsense: no data, non-XML data
    $url = sprintf('https://spreadsheets.google.com/feeds/cells/%s/%d/public/basic', $tablekey, 1 );
    $xml = @file_get_contents($url);
    if (! $xml) throw new PlaceDataSourceErrorException( array("No data found. Check the URL, and make sure that it is \"Published to the web\".") );
    if (substr($xml,0,5) != '<?xml') throw new PlaceDataSourceErrorException( array("No data found. Check the URL, and make sure that it is \"Published to the web\".") );

    // replace $xml from the XML string to a XML parser, or die trying
    try {
        $xml = @new SimpleXMLElement($xml);
    } catch (Exception $e) {
        throw new PlaceDataSourceErrorException( array('Invalid data found. Identifies as XML, but could not be processed.') );
    }

    // guess we got it; final checks
    if (! sizeof($xml->entry) ) throw new PlaceDataSourceErrorException( array('No rows found in the spreadsheet.') );

    // crunch it
    // load the spreadsheet and create several side effects:
    // $column_name et al   These are culled from Row 1, since we're iterating anyway; ultimately we should have all required fields defined with $column indexes
    // $cells               Mapping of cell=>value, e.g. "B12"=>"Green Trees Park"   Used for quick access once we figure out our target fields
    // $maxrow              The highest row number found; then we can iterate 2..$maxrow and know that we're covering a range of rows
    // $colnames            Assoc of column letters onto name, e.g. "B"=>"Park Name"
    $maxrow   = 0;
    $cells    = array();
    $colnames = array();
    $column_name = null;
    $column_desc = null;
    $column_lat  = null;
    $column_lon  = null;
    $column_url  = null;

    foreach ($xml->entry as $cell) {
        $cellid    = (string) $cell->title;
        preg_match('/^([A-Z]+)(\d+)$/', $cellid, $cellinfo);
        $colletter = (string)  $cellinfo[1];
        $rownumber = (integer) $cellinfo[2];
        $value     = (string)  $cell->content;

        // if the row# is higher than our current max, increment it
        if ($rownumber > $maxrow) $maxrow = $rownumber;

        // if this cell is in row 1 *and* its name matches one of our target fields, then we have found a column ID   (e.g. the Name field by whatever name, is column E)
        if ($rownumber==1 and $value == $namefield) $column_name = $colletter;
        if ($rownumber==1 and $value == $descfield) $column_desc = $colletter;
        if ($rownumber==1 and $value == $latfield)  $column_lat  = $colletter;
        if ($rownumber==1 and $value == $lonfield)  $column_lon  = $colletter;
        if ($rownumber==1 and $value == $urlfield)  $column_url  = $colletter;
        if ($rownumber==1 and $value == $urlfield2) $column_url2 = $colletter;

        // if this cell is in row 1 then we have found a column label, e.g. B=>Park Name
        if ($rownumber==1) $colnames[$colletter] = $value;

        // load the cells registry; a modest accomplishment, but one which will pay off in a moment
        $cells[$cellid] = $value;
    }
    if (! $column_name) throw new PlaceDataSourceErrorException( array("Parsing error: Couldn't figure out column letter for Name") );
    if ($descfield and ! $column_desc) throw new PlaceDataSourceErrorException( array("Parsing error: Couldn't figure out column letter for Desc") );
    if (! $column_lat ) throw new PlaceDataSourceErrorException( array("Parsing error: Couldn't figure out column letter for Latitude") );
    if (! $column_lon ) throw new PlaceDataSourceErrorException( array("Parsing error: Couldn't figure out column letter for Longitude") );
    if ($urlfield and ! $column_url) throw new PlaceDataSourceErrorException( array("Parsing error: Couldn't figure out column letter for URL") );

    // start the verbose output
    $details = array();
    $details[] = "Loaded $url";

    // prep work: deletions
    // compose a list of all Remote-ID currently in the database within this data source
    // as we go over the records we'll remove them from this list
    // anything still remaining at the end of this process, is no longer in the remote data source and therefore should be deleted from the local database to match
    $howmany_old = $this->place->count();
    $details[] = sprintf("Cataloging %d old Place entries for possible removal", $howmany_old );
    $deletions = array();
    foreach ($this->place as $old) $deletions[$old->remoteid] = $old->id;

    // pass 2
    // go from row 2 to row $maxrow and fetch specifically the columns we want to form this record
    // hint: blank cells are omitted from the spreadsheet output -- cell X99 being NULL in the spreadsheet, means it's undefined in $cells
    // use PHP's @stfu operator to allow these to silently be NULLed, since we handle their being blank/undef anyway
    $records_new       = 0;
    $records_updated   = 0;
    $records_badcoords = 0;
    $records_noname    = 0;

    for ($i=2; $i<=$maxrow; $i++) {
        $remoteid = $cells["{$column_name}{$i}"]; // no real remote ID so we use the name, I am certain that we'll regret this some day but since the Spreadsheet API lacks a true "row ID" separate from the row number, it's what we have
        $name     = @$cells["{$column_name}{$i}"];
        $desc     = @$cells["{$column_desc}{$i}"];
        $lon      = (float) @$cells["{$column_lon}{$i}"];
        $lat      = (float) @$cells["{$column_lat}{$i}"];
        $url      = @$cells["{$column_url}{$i}"];
        $url2     = @$cells["{$column_url2}{$i}"];
        if ($url and substr($url,0,4) != 'http') $url = "http://$url";

        // all attributes including and excluding those key ones targeted above; use the list of $colnames and make a simple assoc
        $attributes = array();
        foreach ($colnames as $acol=>$albl) $attributes[$albl] = @$cells["{$acol}{$i}"];

        // missing a name? give a blank one but increment the warning count
        if (! $name) {
            $records_noname++;
            $name = '';
            $details[] = "Record $remoteid lacks a name";
        }
        // check for obviously bad coordinates
        if (!$lon or !$lat or $lat>90 or $lat<-90 or $lon<-180 or $lon>180) {
            $records_badcoords++;
            $details[] = "Record $remoteid coordinates do not look right: $lat $lon";
            continue;
        }

        // guess we're good
        // either update the existing Place or create a new one
        $place = new Place();
        $place->where('placedatasource_id',$this->id)->where('remoteid',$remoteid)->get();
        if ($place->id) {
            // update of an existing Place; remove this record from the "to be deleted cuz it's not in the remote source" list
            unset($deletions[$remoteid]);

            $details[] = "Updating record {$remoteid}";
            $records_updated++;
        } else {
            // a new Place; set the DSID, and also Remote ID so we can identify it on future runs
            $place->placedatasource_id  = $this->id;
            $place->remoteid            = $remoteid;

            $details[] = "Creating new record {$remoteid} -- $name";
            $records_new++;
        }

        $place->name             = substr($name,0,50);
        $place->description      = $desc;
        $place->latitude         = $lat;
        $place->longitude        = $lon;
        $place->url              = $url;
        $place->urltext          = $urltext;
        $place->url2             = $url2;
        $place->urltext2         = $urltext2;
        $place->attributes_json  = json_encode($attributes);
        $place->save();
    }

    // delete any "leftover" records in $deletions
    // any that are in the remote data source, would have been removed based on their 'remoteid' field
    if (sizeof($deletions)) {
        // do the delete...
        $delete = new Place();
        $delete->where('placedatasource_id',$this->id)->where_in('id', array_values($deletions) )->get();
        foreach ($delete as $d) {
            $d->delete();
            $details[] = "Deleting outdated record: {$d->remoteid} : $d->name";
        }

        // then make $deletions simply the number of records deleted
        $deletions = sizeof($deletions);
    } else {
        $deletions = false;
    }

    // success! update our last_fetch date then throw an exception
    $this->last_fetch = time();
    $this->save();
    $messages = array();
    $messages[] = "$records_new new locations added to database.";
    $messages[] = "$records_updated locations updated.";
    if ($deletions)         $messages[] = "$deletions outdated locations deleted.";
    if ($records_noname)    $messages[] = "$records_noname places had a blank name.";
    if ($records_badcoords) $messages[] = "$records_badcoords places skipped due to bad coordinates.";
    $info = array(
        'added'   => $records_new,
        'updated' => $records_updated,
        'deleted' => $deletions,
        'nogeom'  => $records_badcoords,
        'details' => $details,
    );
    throw new PlaceDataSourceSuccessException($messages,$info);
}


/*
 * listFields()
 * Connect to the data source and grab a list of field names. Return an array of string field names.
 */
public function listFields() {
    // no URL at all? maybe they just now created a stub entry and they know they've not entered an URL
    // that's fine; just make the errmsg a bit simpler for them, and don't bother with the imminent failures below
    if (! $this->url) throw new PlaceDataSourceErrorException( array("Start by entering the URL of your Google Spreadsheet.") );

    // grok the table key from the URL given; be strict about the URL, making sure it's really over at Google Docs
    $tablekey = null;
    preg_match('!https://docs.google.com/spreadsheet/ccc/?\?key=([\w\_\-]+)!i', $this->url, $tablekey );
    if (! $tablekey) {
        preg_match('!https://docs.google.com/spreadsheets/\w+/([\w\_\-]+)/pubhtml!i', $this->url, $tablekey );
    }
    $tablekey = @$tablekey[1];

    // compose the URL and fetch the spreadsheet content
    // then check for nonsense: no data, non-XML data
    $url = sprintf('https://spreadsheets.google.com/feeds/cells/%s/%d/public/basic', $tablekey, 1 );
    $xml = @file_get_contents($url);
    if (! $xml) throw new PlaceDataSourceErrorException( array("No data found. Check the URL, and make sure that it is \"Published to the web\".") );
    if (substr($xml,0,5) != '<?xml') throw new PlaceDataSourceErrorException( array("No data found. Check the URL, and make sure that it is \"Published to the web\".") );

    // replace $xml from the XML string to a XML parser, or die trying
    try {
        $xml = @new SimpleXMLElement($xml);
    } catch (Exception $e) {
        throw new PlaceDataSourceErrorException( array('Invalid data found. Identifies as XML, but could not be processed.') );
    }

    // guess we got it; final checks
    if (! sizeof($xml->entry) ) throw new PlaceDataSourceErrorException( array('No rows found in the spreadsheet.') );

    // generate the output, a flat list
    // a prior version accepted an $assoc=TRUE param to generate assoc arrays, but this got into "what would the caller want?" guesswork, and is best left to the caller
    $output = array();
    foreach ($xml->entry as $cell) {
        $cellname = (string) $cell->title;
        $colname  = (string) $cell->content;
        if (! preg_match('/^[A-Z]+1$/',$cellname)) continue;

        $output[] = $colname;
    }
    natcasesort($output);
    return $output;
}


/**********************************************************************************************
 * STATIC FUNCTIONS
 * utility functions
 **********************************************************************************************/



} // end of Model
