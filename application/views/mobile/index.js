///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// GLOBAL SETTINGS
///////////////////////////////////////////////////////////////////////////////////////////////////////////

// map stuff, see initMap() and ; see also onLocationFound()
var MAP;            // L.Map
var BASEMAPS = {};  // dict mapping a name onto a L.tileLayer instance; keys will be:   terrain   topo   photo
var MAX_EXTENT;     // L.latLngBounds; used for geocode biasing and as our starting extent
var MARKERS;        // L.LayerGroup; empty but gets filled with markers when they search
var LOCATION;       // L.Marker indicating their current location
var ACCURACY;       // L.Circle showing the accuracy of their location

// should we auto-recenter the map when location is found?
var AUTO_RECENTER = true;


///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// JAVASCRIPT EXTENSIONS
///////////////////////////////////////////////////////////////////////////////////////////////////////////

// IE8 lacks the indexOf to find where/whether an item appears in an array
if (!Array.prototype.indexOf) {
  Array.prototype.indexOf = function(elt /*, from*/) {
    var len = this.length >>> 0;

    var from = Number(arguments[1]) || 0;
    from = (from < 0) ? Math.ceil(from) : Math.floor(from);
    if (from < 0) from += len;

    for (; from < len; from++) {
        if (from in this && this[from] === elt) return from;
    }
    return -1;
  };
}


// "hello world".capfirst() = "Hello world"
String.prototype.capfirst = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// LEAFLET EXTENSIONS
///////////////////////////////////////////////////////////////////////////////////////////////////////////


// extend Leaflet: add to LatLng the ability to calculate the bearing to another LatLng
L.LatLng.prototype.bearingTo = function(other) {
    var d2r  = L.LatLng.DEG_TO_RAD;
    var r2d  = L.LatLng.RAD_TO_DEG;
    var lat1 = this.lat * d2r;
    var lat2 = other.lat * d2r;
    var dLon = (other.lng-this.lng) * d2r;
    var y    = Math.sin(dLon) * Math.cos(lat2);
    var x    = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
    var brng = Math.atan2(y, x);
    brng = parseInt( brng * r2d );
    brng = (brng + 360) % 360;
    return brng;
};

L.LatLng.prototype.bearingWordTo = function(other) {
    var bearing = this.bearingTo(other);
    var bearingword = '';
    if      (bearing >=  22 && bearing <=  67) bearingword = 'NE';
    else if (bearing >=  67 && bearing <= 112) bearingword =  'E';
    else if (bearing >= 112 && bearing <= 157) bearingword = 'SE';
    else if (bearing >= 157 && bearing <= 202) bearingword =  'S';
    else if (bearing >= 202 && bearing <= 247) bearingword = 'SW';
    else if (bearing >= 247 && bearing <= 292) bearingword =  'W';
    else if (bearing >= 292 && bearing <= 337) bearingword = 'NW';
    else if (bearing >= 337 || bearing <=  22) bearingword =  'N';
    return bearingword;
};


///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// PAGE RESIZING
///// this is not at all as automated as some folks would have you believe  ;)
///// changing to #page-map has race conditions, iPads lie about their width & height, ...
///////////////////////////////////////////////////////////////////////////////////////////////////////////

$(window).bind('orientationchange pageshow pagechange resize', resizeMap);

function resizeMap() {
    if (! $("#map_canvas").is(':visible') ) return;

    var viewportHeight = $(window).height();

    var page    = $(":jqmData(role='page'):visible");
    var header  = $(":jqmData(role='header'):visible");
    var content = $(":jqmData(role='content'):visible");
    var contentHeight = viewportHeight - header.outerHeight();
    $(":jqmData(role='content')").first().height(contentHeight);

    $("#map_canvas").height(contentHeight);
    if (MAP) MAP.invalidateSize();
}

function switchToMap(callback) {
    $.mobile.changePage('#page-map');
    if (callback) setTimeout(callback,500);
    setTimeout(resizeMap,600);
}



///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// INITIALIZATION
///////////////////////////////////////////////////////////////////////////////////////////////////////////

$(document).ready(function () {
    // go ahead and render the page elements, so we don't fall victim to lazy loading
    $('div[data-role="page"]').page();

    // now various sub-initializations
    initMap();
    initSearchForms();
});

function initSearchForms() {
    // enable the 2 "GO" buttons on the home (Search) page
    $('#page-search button[name="search-browse-map"]').tap(function () {
        performBrowseMap();
    });
    $('#page-search button[name="search-go"]').tap(function () {
        performSearch();
    });

    // DOM handler: when the Address Type changed to address, show the address box; when it's not address, hide the box
    // then specifically force it to GPS option (Firefox caches controls selections) to hide the address box
    $('#page-search select[name="location"]').change(function () {
        switch ( $(this).val() ) {
            case 'address':
                $('#page-search input[name="address"]').show();
                break;
            case 'gps':
                $('#page-search input[name="address"]').hide();
                break;
        }
    }).val('gps').trigger('change');

    // jQuery Mobile bug workaround: when changing pages, tabs won't keep their previous selected state
    // so when we go to Search Results, switch to Places so we're switched to SOMETHING
    $(document).on('pageshow', '#page-search-results', function(){
        $(this).find('div[data-role="navbar"] li a').first().click();
    });

    // trigger a rendering of Nothing Found at this time, as if a search had been performed
    // this populates the Results panel, which someone could find via the Map panel having not done a search
    performSearchHandleResults({ places:[], events:[] });
}

function initMap() {
    // define that biasing box for geocoding, which is also our default starting view
    MAX_EXTENT = L.latLngBounds([[START_N,START_E],[START_S,START_W]]);

    // define the basemaps
    BASEMAPS['terrain'] = L.tileLayer("http://{s}.tiles.mapbox.com/v3/greeninfo.map-3x7sb5iq/{z}/{x}/{y}.jpg", { name:'Terrain', subdomains:['a','b','c','d'] });
    BASEMAPS['photo']   = L.tileLayer("http://{s}.tiles.mapbox.com/v3/greeninfo.map-zudfckcw/{z}/{x}/{y}.jpg", { name:'Photo', subdomains:['a','b','c','d'] });
    BASEMAPS['topo']    = L.tileLayer("http://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}.jpg", { name:'Topo' });

    // load the map and its initial view
    MAP = new L.Map('map_canvas', {
        attributionControl: false,
        zoomControl: true,
        dragging: true,
        closePopupOnClick: false,
        crs: L.CRS.EPSG3857
    }).fitBounds(MAX_EXTENT);
    selectBasemap('terrain');

    // define the marker and circle for our location and accuracy
    var icon = L.icon({
        iconUrl: BASE_URL + 'application/views/mobile/images/marker-gps.png',
        iconSize:     [25, 41], // size of the icon
        iconAnchor:   [13, 41], // point of the icon which will correspond to marker's location
        popupAnchor:  [13,  1] // point from which the popup should open relative to the iconAnchor
    });
    LOCATION  = L.marker([0,0], { clickable:false, draggable:false, icon:icon }).addTo(MAP);
    ACCURACY  = L.circle([0,0], 1000, { clickable:false }).addTo(MAP);

    // set up the event handler when our location is detected, and start continuous tracking
    // loose binding with an anonymous function, for easier debugging (can replace the function in the console)
    MAP.on('locationfound', function (event) { onLocationFound(event); });
    MAP.on('locationerror', function (error) { onLocationError(error); });
    MAP.locate({ enableHighAccuracy:true, watch:true });

    // add some Controls, including our custom ones which are simply buttons; we use a Control so Leaflet will position and style them
    L.control.scale({ metric:false }).addTo(MAP);
    new L.controlCustomButtonPanel().addTo(MAP);

    // now add the empty MARKERS LayerGroup
    // this will be loaded with markers when a search is performed or when they pick Browse The Map
    MARKERS = L.layerGroup([]).addTo(MAP);

    // now the Map Settings panel
    // this is relatively simple, in that there's no tile caching, seeding, database download, ...
    $('#panel-map-settings input[type="radio"][name="basemap"]').change(function () {
        var which = $('#panel-map-settings input[type="radio"][name="basemap"]:checked').prop('value');
        selectBasemap(which);
    });
}


///////////////////////////////////////////////////////////////////////////////////////////////////////////
///// FUNCTIONS
///////////////////////////////////////////////////////////////////////////////////////////////////////////

function selectBasemap(which) {
    for (var i in BASEMAPS) MAP.removeLayer(BASEMAPS[i]);
    BASEMAPS[which].addTo(MAP).bringToBack();
}

function onLocationFound(event) {
    // first and easiest: update the location and accuracy markers
    LOCATION.setLatLng(event.latlng);
    ACCURACY.setLatLng(event.latlng).setRadius(event.accuracy);

    if (AUTO_RECENTER) {
        MAP.panTo(event.latlng);
        if (MAP.getZoom() < 14) MAP.setZoom(14);
    }

    // update distance and bearing listings for Places and Events
    updateEventsAndPlacesDistanceReadouts();
}

function autoCenterToggle() {
    AUTO_RECENTER ? autoCenterOff() : autoCenterOn();
}
function autoCenterOn() {
    AUTO_RECENTER = true;
    $('#map_canvas div.leaflet-custombutton-gps').addClass('active');

    // and now that we want auto-centering, do an auto-center now
    zoomToCurrentLocation();
}
function autoCenterOff() {
    AUTO_RECENTER = false;
    $('#map_canvas div.leaflet-custombutton-gps').removeClass('active');
}

function zoomToCurrentLocation() {
    var latlng = LOCATION.getLatLng();
    var buffer = 0.1; // about 5-6 miles, a reasonable distance

    var w = latlng.lng - buffer;
    var s = latlng.lat - buffer;
    var e = latlng.lng + buffer;
    var n = latlng.lat + buffer;
    MAP.fitBounds([[n,e],[s,w]]);
}

function zoomToPoint(latlng) {
    var buffer = 0.025; // about 1-2 miles, a reasonable distance

    var w = latlng.lng - buffer;
    var s = latlng.lat - buffer;
    var e = latlng.lng + buffer;
    var n = latlng.lat + buffer;
    MAP.fitBounds([[n,e],[s,w]]);
}

function zoomToCurrentMaxExtent() {
    MAP.fitBounds(MAX_EXTENT);
}

function onLocationError(error) {
    //gda show warnings on map and search panel?
}

function performBrowseMap() {
    // gda: fetch All markers, I guess?

    // now switch to the map and zoom to either the whole area (if we have no LOCATION known) or else to our own area (if we do have LOCATION)
    switchToMap(function () {
        var has = LOCATION.getLatLng().lat;
        if (has) {
            zoomToCurrentLocation();
        } else {
            zoomToCurrentMaxExtent();
        }
    });
}

function getMarkerById(id) {
    // convenience function: given an ID from the fetchdata output, find the corresponding Marker within the MARKERS layergroup
    // if it doesn't exist, null is returned
    var lx = MARKERS.getLayers();
    for (var i=0, l=lx.length; i<l; i++) {
        if (id == lx[i].options.attributes.id) return lx[i];
    }
    return null;
}

function performSearch() {
    // validation and checking: if they picked an address search, they need to have given an address
    // further, we can't really search with an address, but need to geocode first
    var $form = $('#page-search form');

    switch ( $form.find('select[name="location"]').val() ) {
        case 'gps':
            // Near My search: fill in the lat & lng from their last known LOCATION
            // then go ahead and perform a search
            var latlng = LOCATION.getLatLng();
            $form.find('input[name="lat"]').val( latlng.lat );
            $form.find('input[name="lng"]').val( latlng.lng );
            performSearchReally();
            break;
        case 'address':
            // Address search: do an async geocoder call
            // have it fill in the lat & lng from whatever it finds, then it will perform the search
            if (! BING_API_KEY) return alert("Address searches disabled.\nNo Bing Maps API key has been entered by the site admin.");
            var address = $form.find('input[name="address"]').val();
            if (! address) return alert('Enter an address.');
            performSearchAfterGeocode(address);
            break;
        default:
            break;
    }
}

function performSearchReally() {
    // compose params, send it off
    var params = $('#page-search form').serialize();
    $.mobile.loading('show', {theme:"a", text:"Searching", textonly:false, textVisible:true });
    $.post(BASE_URL + 'mobile/fetchdata', params, function (reply) {
        $.mobile.loading('hide');
        performSearchHandleResults(reply);
    }, 'json');
}

function performSearchAfterGeocode(address) {
    var handleReply = function (result) {
        if (! result || ! result.resourceSets.length) return alert("Could not find that address.");
        if (result.authenticationResultCode != 'ValidCredentials') return alert("The Bing Maps API key appears to be invalid.");

        try {
            var $form = $('#page-search form');
            var best  = result.resourceSets[0].resources[0].geocodePoints[0].coordinates;
            $form.find('input[name="lat"]').val( best[0] );
            $form.find('input[name="lng"]').val( best[1] );
            performSearchReally();
        } catch (e) {
            return alert('Could not process the geocoder reply.');
        }
    };

    var url           = 'http://dev.virtualearth.net/REST/v1/Locations';
    var params        = {};
    params.query      = address;
    params.key        = BING_API_KEY;
    params.output     = 'json';
    params.maxResults = 1;
    $.ajax({
        url: url,
        'data': params,
        dataType: 'jsonp',
        jsonp: 'jsonp',
        success: handleReply,
        crossDomain: true
    });
}

function performSearchHandleResults(reply) {
    // assign the results into the listing components (listviews, map) ...
    $('#page-search-results-places-list').data('rawresults', reply.places);
    $('#map_canavs').data('rawresults', reply.places);
    $('#page-search-results-events-list').data('rawresults', reply.events);

    // .. then have them re-render
    // the listing renderers check for 0 length and create a dummy "Nothing Found" item in the lists
    // tip: show and hide don't work with JQM tab content; it makes the element actually visible despite the tab selection
    MARKERS.clearLayers();
    renderEventsList();
    renderEventsMap();
    renderPlacesMap();
    renderPlacesList();

    // ... then show the results
    $.mobile.changePage('#page-search-results');

    // epimetheus: same as onLocationFound() does, update distance and bearing listings for Places and Events
    updateEventsAndPlacesDistanceReadouts();
}

function renderPlacesMap() {
    var items = $('#page-search-results-places-list').data('rawresults');

    for (var i=0, l=items.length; i<l; i++) {
        var lat  = items[i].lat;
        var lng  = items[i].lng;
        var name = items[i].name;

        var html  = '<h2>' + items[i].name + '</h2>';
            html += items[i].desc;
        if (items[i].url) {
            html += '<p><a target="_blank" href="'+items[i].url+'">More Info</a></p>';
        }

        L.marker([lat,lng], { title:name, attributes:items[i] }).bindPopup(html).addTo(MARKERS);
    }
}

function renderEventsMap() {
    var items = $('#page-search-results-events-list').data('rawresults');

    for (var i=0, l=items.length; i<l; i++) {
        var lat  = items[i].lat;
        var lng  = items[i].lng;
        var name = items[i].name;
        if (! lat || ! lng) continue; // only PlaceActivity items would have lat/lng and thus location

        var html  = '<h2>' + items[i].subtitle + '</h2>';
            html += items[i].name;

        L.marker([lat,lng], { title:name, attributes:items[i] }).bindPopup(html).addTo(MARKERS);
    }
}

function renderPlacesList() {
    var $target = $('#page-search-results-places-list').empty();
    var items   = $target.data('rawresults');

    // bail condition: 0 items means we need to display only 1 item: Nothing Found
    if (! items.length) {
        $('<li></li>').html('No places matched your filters.<br/>Use the Find button below, to search for places and events.').appendTo($target);
        $target.listview('refresh');
        return;
    }

    for (var i=0, l=items.length; i<l; i++) {
        var item = items[i];
        var li   = $('<li></li>').data('rawresult',item).appendTo($target);

        var label = $('<div></div>').addClass('ui-btn-text').appendTo(li);
        var categories = item.category_names.join(", ");
        $('<span></span>').addClass('ui-li-heading').text(item.name).appendTo(label);
        $('<div></div>').addClass('ui-li-desc').text(categories).appendTo(label);
        $('<span></span>').addClass('ui-li-count').text(' ').appendTo(label); // the distance & bearing aren't loaded yet; see onLocationFound()

        // tap/click handler -- zoom to this location on the map
        li.tap(function () {
            var latlng = L.latLng([ $(this).data('rawresult').lat, $(this).data('rawresult').lng ]);
            var markid = $(this).data('rawresult').id;
            switchToMap(function () {
                zoomToPoint(latlng);
                var marker = getMarkerById(markid);
                if (marker) marker.openPopup();
            });
        });
    }

    $target.listview('refresh');
}

function renderEventsList() {
    var $target = $('#page-search-results-events-list').empty();
    var items   = $target.data('rawresults');

    // bail condition: 0 items means we need to display only 1 item: Nothing Found
    if (! items.length) {
        $('<li></li>').html('No events matched your filters.<br/>Use the Find button below, to search for places and events.').appendTo($target);
        $target.listview('refresh');
        return;
    }

    for (var i=0, l=items.length; i<l; i++) {
        var item = items[i];
        var li   = $('<li></li>').data('rawresult',item).appendTo($target);

        var label = $('<div></div>').addClass('ui-btn-text').appendTo(li);
        $('<span></span>').addClass('ui-li-heading').text(item.name).appendTo(label);
        $('<div></div>').addClass('ui-li-desc').html(item.subtitle ? item.subtitle : '&nbsp;').appendTo(label);
        $('<div></div>').addClass('ui-li-desc').text(item.datetime).appendTo(label);
        if (item.lat && item.lng) {
            // the distance & bearing aren't loaded yet; see onLocationFound() but we know that this item should have one
            $('<span></span>').addClass('ui-li-count').text(' ').appendTo(label);
        }

        // now the tap/click handler: if there's an URL then visit it
        // otherwise see if we can zoom on the map
        if (item.url) {
            li.tap(function () {
                var url = $(this).data('rawresult').url;
                if (! url) return;
                window.open(url);
            });
        } else if (item.lat && item.lng) {
            li.tap(function () {
                var markid = $(this).data('rawresult').id;
                var latlng = L.latLng([ $(this).data('rawresult').lat, $(this).data('rawresult').lng ]);
                switchToMap(function () {
                    zoomToPoint(latlng);
                    var marker = getMarkerById(markid);
                    if (marker) marker.openPopup();
                });
            });
        }

    }

    $target.listview('refresh');
}

function updateEventsAndPlacesDistanceReadouts() {
    // prep
    // figure up the origin for the distance & bearing; whatever was our last search
    // if they somehow got here and never did a search of any sort, just bail; should never happen
    var origin = L.latLng([ $('#page-search input[name="lat"]').val() , $('#page-search input[name="lng"]').val() ]);
    if (! origin) return;

    // part 1
    // Events list gets distance and bearing... for anything which in fact has a lat & lon
    var $target   = $('#page-search-results-events-list');
    var $children = $target.children('li');
    $children.each(function () {
        // no lat & lon? then the distance is "No location" and we skip it
        var raw = $(this).data('rawresult');
        if (!raw) return; // e.g. page startup when nothing has been found, only LI is "Nothing to show"
        if (!raw.lat || !raw.lng) return; // no location? move on

        // construct a L.LatLng and use our handy functions for distance and bearing, relative to our last search location
        var latlng    = L.latLng([ raw.lat,raw.lng ]);
        var meters    = origin.distanceTo(latlng);
        var direction = origin.bearingWordTo(latlng);
        var readout;
        switch (DISTANCE_UNITS) {
            case 'mi':
                readout = (meters / 1609).toFixed(1) + ' ' + 'mi' + ' ' + direction;
                break;
            case 'km':
                readout = (meters / 1000).toFixed(1) + ' ' + 'km' + ' ' + direction;
                break;
        }

        // load the text field
        $(this).find('span.ui-li-count').text(readout);

        // unlike Places we don't sort by distance cuz they're sorted by ending time
        // so we're done here
    });

    // part 2
    // Places list gets distance and bearing, but then gets sorted by distance
    var $target   = $('#page-search-results-places-list');
    var $children = $target.children('li');
    $children.each(function () {
        var raw = $(this).data('rawresult');
        if (! raw) return; // e.g. page startup when nothing has been found, only LI is "Nothing to show"

        // construct a L.LatLng and use our handy functions for distance and bearing, relative to our last search location
        var latlng    = L.latLng([ raw.lat,raw.lng ]);
        var meters    = origin.distanceTo(latlng);
        var direction = origin.bearingWordTo(latlng);
        var readout;
        switch (DISTANCE_UNITS) {
            case 'mi':
                readout = (meters / 1609).toFixed(1) + ' ' + 'mi' + ' ' + direction;
                break;
            case 'km':
                readout = (meters / 1000).toFixed(1) + ' ' + 'km' + ' ' + direction;
                break;
        }

        // load the text field and also save the meters to a data attribute, for distance sorting in a moment
        $(this).data('distance_meters',meters);
        $(this).find('span.ui-li-count').text(readout);
    });

    // sort the listview by distance
    $children.tsort({data:'distance_meters'});
}