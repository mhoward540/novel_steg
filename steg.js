const RED_CHANNEL = 1;
const GREEN_CHANNEL = 2;
const BLUE_CHANNEL = 3;
const ALPHA_CHANNEL = 4;
const BYTE_SIZE = 8;

var inputIsDirty = true;
var canvas;
var ctx;
var imageCapacity;
var keys;
var inputFile;
var mode;

function steg(e) {
	var inputFileBuffer;
	
	var imgInput = getInputImage();
	var keyInput = readKeysFromInputs();
	var fileInput = getInputFile();
	if (!validateKeys(keyInput) || !imgInput || !fileInput) {
		//TODO figure out what to do here i.e. what do we display to the user and by what means
		console.log("Error");
		console.log(keyInput, imgInput, fileInput);
		return false;
	}
	
	//TODO hardcoding blue channel for now, at some point we can let the user choose
	keys = calculateKeyCapacityForChannel(imgInput, keyInput, BLUE_CHANNEL);
	imageCapacity = calculateChannelCapacity(keyInput);

	pFileReader(fileInput).then(function(e) {
		inputFileBuffer = e.target.result;
		console.log(`Message size: ${inputFileBuffer.byteLength} bytes, Size of message length: ${getSizeOfNumberInBytes(inputFileBuffer.byteLength)} bytes, Image capacity: ${imageCapacity} bytes`);
		if (inputFileBuffer.byteLength > imageCapacity - Math.floor(getSizeOfNumberInBytes(inputFileBuffer.byteLength)))  {
			console.log('Message is larger than the image\'s maximum capacity');
			return false;
		}

		var messageArr = getTypedMessageArr(inputFileBuffer);
		
		if (!messageArr) {
			console.log('Could not get typed array from input file');
			return false;
		}
		
		var stegImage = getStegImage(getKeys(), imgInput, messageArr);
		ctx.putImageData(stegImage, 0, 0);
		console.log(stegImage);
	});
}

function pFileReader(file) {
  return new Promise((resolve, reject) => {
    var fr = new FileReader();  
    fr.onload = resolve;
    fr.readAsArrayBuffer(file);
  });
}

function getStegImage(keys, imgInput, messageArr) {
	//amount of message remaining, in bits
	var messageRemaining = messageArr.byteLength * BYTE_SIZE;
	//TODO maybe don't assume that channelOffset is channel - 1
	var channelOffset = BLUE_CHANNEL - 1;
	var currPixel;
	var currCapacity;
	var bitBuffer = messageArr[0];
	var bufferRemaining = BYTE_SIZE;
	var messageOffset = 0;
	var currLowerBound;
	var currUpperBound;
	var messageLength = 0;
	var performInsertOnCurrentIteration;
	for (var i = 0; i < imgInput.data.length; i += 4) {
		//break if we copied the whole message
		if (messageRemaining <= 0) {
			break;
		}

		currPixel = imgInput.data[i + channelOffset];
		currCapacity = 0;
		performInsertOnCurrentIteration = false;
		for (var j = 0; j < keys.length; j += 1) {
			if (currPixel >= keys[j].lowerBound && currPixel <= keys[j].upperBound) {
				performInsertOnCurrentIteration = true;
				currCapacity = keys[j].capacity;
				currLowerBound = keys[j].lowerBound;
				currUpperBound = keys[j].upperBound;
				break;
			}
		}
		
		if (!performInsertOnCurrentIteration) {
			continue;
		}
		
		//We only want to write data if it fits exactly into the current pixel. Example: if theres only 3 bits of the message remaining, we do not want to write it into a pixel with a 5 bit capaciy
		if (messageRemaining - currCapacity < 0) {
			continue;
		}
		
		//If we can hold more than we have available to write, then we should write what we have and get more data to write
		if (bufferRemaining - currCapacity < 0) {
			//Since we are guaranteed the bottom bits of bitBuffer will be 0 after writing, we can write the excess bits to the current pixel here, and then write the rest later
			currPixel = writeBitsToPixel(bitBuffer, currPixel, currCapacity);
			messageLength = bufferRemaining;
			currCapacity -= messageLength;
			messageOffset += 1;
			bitBuffer = messageArr[messageOffset];
			messageRemaining -= bufferRemaining;
			bufferRemaining = BYTE_SIZE;
		}
		
		//Write the data, decrement the amount of data left to write
		currPixel = writeBitsToPixel(bitBuffer, currPixel, currCapacity);
		messageLength += currCapacity;
		currPixel = adjustPixelToRange(currPixel, messageLength, currLowerBound, currUpperBound);
		bitBuffer = (bitBuffer << currCapacity) & (Math.pow(2, BYTE_SIZE)-1);
		messageRemaining -= currCapacity;
		bufferRemaining -= currCapacity;
		
		messageLength = 0;
		imgInput.data[i + channelOffset] = currPixel;
	}
	
	if (messageRemaining > 0) {
		console.log('Did not write whole message to image');
		//return false;
	}
	return imgInput;
}

//This writes numBitsToWrite bits to pixel from the MSB of bits. If numBitsToWrite > 8, this will return 0
function writeBitsToPixel(bits, pixel, numBitsToWrite) {
	//This mask should keep the top (8 - numBitsToWrite) bits of the Pixel
	var upperMask = (Math.pow(2, BYTE_SIZE)-1) - (Math.pow(2, numBitsToWrite) - 1);
	
	//Keep the top (8 - numBitsToWrite) bits of pixel, and write numBitsToWrite bits to the bottom end by shifting the MSB down by (8 - numBitsToWrite)
	return (pixel & upperMask) | (bits >>> (BYTE_SIZE - numBitsToWrite));
}

function adjustPixelToRange(pixel, messageLength, lowerBound, upperBound) {
	var currMask;
	var currFlipIndex = messageLength;
	//while the pixel is not in the boundaries
	while( !(pixel >= lowerBound && pixel <= upperBound) ) {
		currMask = 1 << currFlipIndex;
		currFlipIndex += 1;
		//flip bit
		pixel ^= currMask;
	}
	
	return pixel;
}

function readBitsFromPixel(pixel, numBitsToRead) {
	var mask = Math.pow(2, numBitsToRead) - 1;
	return pixel & mask;
}

function getTypedMessageArr(inputFileBuffer) {
	var dataView;
	
	//Fill the first part of the message with the length of the message file
	switch (getSizeOfNumberInBytes(inputFileBuffer.byteLength)) {
		case Uint8Array.BYTES_PER_ELEMENT:
			dataView = new DataView((new Uint8Array(1).buffer));
			dataView.setUint8(0, inputFileBuffer.byteLength * BYTE_SIZE);
			break;
		case Uint16Array.BYTES_PER_ELEMENT:
			dataView = new DataView((new Uint16Array(1).buffer));
			dataView.setUint16(0, inputFileBuffer.byteLength * BYTE_SIZE);
			break;
		case Uint32Array.BYTES_PER_ELEMENT:
			dataView = new DataView((new Uint32Array(1).buffer));
			dataView.setUint32(0, inputFileBuffer.byteLength * BYTE_SIZE);
			break;
		default:
			return false;

	}
	
	//Merge the input file buffer with the buffer containing the length of the input file
	var fileArr = new Uint8Array(inputFileBuffer);
	var lengthArr = new Uint8Array(dataView.buffer);
	var fullArr = new Uint8Array(fileArr.length + lengthArr.length);
	fullArr.set(lengthArr);
	fullArr.set(fileArr, lengthArr.length);
	return fullArr;
};

function desteg(e) {
	var imgInput = getInputImage();
	var keyInput = readKeysFromInputs();

	if (!validateKeys(keyInput) || !imgInput) {
		//TODO figure out what to do here i.e. what do we display to the user and by what means
		console.log("Error");
		console.log(keyInput, imgInput, fileInput);
		return false;
	}
	
	keys = calculateKeyCapacityForChannel(imgInput, keyInput, BLUE_CHANNEL);
	imageCapacity = calculateChannelCapacity(keyInput);
	var sizeOfMessageLength = getSizeOfNumberInBytes(imageCapacity);
	var messageLength = getMessageLengthFromStegImage(imgInput, keyInput, sizeOfMessageLength);
}

function getMessageLengthFromStegImage(imgInput, keys, sizeOfMessageLength) {
	var bitsRemaining = sizeOfMessageLength * BYTE_SIZE;
	var performExtractOnCurrentIteration;
	var currCapacity;
	var currPixel;
	var currLowerBound;
	var currUpperBound;
	var channelOffset = BLUE_CHANNEL - 1;
	var outputBuffer = new Uint8Array(sizeOfMessageLength);
	var bitBuffer = 0;
	var bitsInBuffer = 0;
	var currentInsertIndex = 0;
	
	for (var i = 0; i < imgInput.data.length; i += 4) {
		if (bitsRemaining <= 0) {
			break;
		}

		currPixel = imgInput.data[i + channelOffset];
		
		performExtractOnCurrentIteration = false;
		for (var j = 0; j < keys.length; j += 1) {
			if (currPixel >= keys[j].lowerBound && currPixel <= keys[j].upperBound) {
				performExtractOnCurrentIteration = true;
				currCapacity = keys[j].capacity;
				currLowerBound = keys[j].lowerBound;
				currUpperBound = keys[j].upperBound;
				break;
			}
		}
		
		if (!performExtractOnCurrentIteration) {
			continue;
		}
		
		
		//TODO: this doesnt seem to be working correctly
		bitBuffer = (bitBuffer << currCapacity) | readBitsFromPixel(currPixel, currCapacity);
		bitsInBuffer += currCapacity;
		if (bitsInBuffer >= BYTE_SIZE) {
			//get 8 bits from bitBuffer and insert them into the outputBuffer, decrementing bitsInBuffer and bitsRemaining
			var insert = ((0xFF << (bitsInBuffer - BYTE_SIZE)) & bitBuffer) >> (bitsInBuffer - BYTE_SIZE);
			outputBuffer[currentInsertIndex] = insert;
			currentInsertIndex += 1;
			bitsInBuffer -= BYTE_SIZE;
			bitsRemaining -= BYTE_SIZE;
			//only keep bitsInBuffer bits in bitBuffer after inserting into outputBuffer
			bitBuffer = bitBuffer & (Math.pow(2, bitsInBuffer) - 1);
		}
		
	}
	
	return outputBuffer;
}

function readKeysFromInputs() {
	keys = [];
	var keyNames = ["one", "two", "three", "four", "five"];
	var currLower;
	var currUpper;
	for (var i = 0; i < keyNames.length; i += 1) {
		currLower = parseInt(document.getElementById("js-rangekey-lower-" + keyNames[i]).value);
		currUpper = parseInt(document.getElementById("js-rangekey-upper-" + keyNames[i]).value);
		keys.push({lowerBound: currLower, upperBound: currUpper});
	}
	
	return keys;
}

function writeImageToCanvas(e) {
	var imgInput = document.getElementById("js-image-input").files[0];
	var reader = new FileReader();
	//Define onload function. Once file is read, create image object and write to canvas
	reader.onload = function(e) {
		var img = new Image();
		img.onload = function() {
			ctx.canvas.width = img.width;
			ctx.canvas.height = img.height;
			ctx.drawImage(img, 0, 0);
		}
		img.src = e.target.result;
	}

	//Read image file, trigger onload
	reader.readAsDataURL(imgInput);
}

//For a given image's channel, calculate the frequency of the keys. Assumes the keys are valid
function calculateKeyCapacityForChannel(imgInput, keys, channel) {
	//TODO maybe don't assume that channelOffset is channel - 1
	var channelOffset = channel - 1;
	var currPixel;
	for (var i = 0; i < imgInput.data.length; i += 4) {
		currPixel = imgInput.data[i + channelOffset];
		for (var j = 0; j < keys.length; j += 1) {
			if (currPixel >= keys[j].lowerBound && currPixel <= keys[j].upperBound) {
				//increment the frequency. if the frequency doesn't exist yet, set it to 1
				keys[j].frequency = typeof keys[j].frequency === "undefined" ? 1 : keys[j].frequency + 1;
				break;
			}
		}
	}
	
	//sort the keys by ascending order of frequency
	keys.sort(function(a, b) {
		return a.frequency - b.frequency;
	});
	
	//now that the keys are in order, we can set their capacity
	for(var i = 0; i < keys.length; i += 1) {
		keys[i].capacity = i + 1;
	}
	
	return keys;
}

//Keys passed in should be passd through calculateKeyCapacityForChannel first
function calculateChannelCapacity(keys) {
	var capacity = 0;
	for(var i = 0; i < keys.length; i += 1){
		capacity += (keys[i].capacity * keys[i].frequency);
	}
	//Return amount of bytes can be held
	//TODO check if this should be bits
	return capacity/BYTE_SIZE;
}

function validateKeys(inputKeys) {
	if (!keys) {
		return false;
	}
	
	var currKey;
	for(var i = 0; i < inputKeys.length; i += 1) {
		currKey = inputKeys[i]
		//TODO create constants for boundaries and lengths
		if (isNaN(currKey.lowerBound) || isNaN(currKey.upperBound) ||
			currKey.lowerBound >= currKey.upperBound ||
			currKey.lowerBound < 0 || currKey.lowerBound > 255 ||
			currKey.upperBound < 0 || currKey.upperBound > 255 ||
			currKey.upperBound - currKey.lowerBound < 31
		){
			return false;
		}
	}

	return !keysOverlap(keys);
}

function keysOverlap(keys) {
	for (var i = 0; i < keys.length; i += 1) {
		for (var j = 0; j < keys.length; j += 1) {
			if (i === j) {
				continue;
			}
			//TODO check this logic...
			if (keys[i].lowerBound <= keys[j].upperBound && keys[j].lowerBound <= keys[i].upperBound) {
				return true;
			}
		}
	}
		
	return false;
}

function handleChannelCapacityCalcClick(e) {
	if (!inputIsDirty) {
		return imageCapacity;
	}
	
	var imgInput = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
	var keyInput = readKeysFromInputs();
	if (!validateKeys(keyInput)) {
		//TODO figure out what to do here i.e. what do we display to the user and by what means
		console.log("Error");
		return false;
	}
	
	//TODO hardcoding blue channel for now, at some point we can let the user choose
	keys = calculateKeyCapacityForChannel(imgInput, keyInput, BLUE_CHANNEL);
	imageCapacity = calculateChannelCapacity(keyInput);
	inputIsDirty = false;
	console.log(`Image capacity = ${imageCapacity} bytes`);
}

function handleFileInput(e) {
	//TODO validations
	inputFile = document.getElementById('js-file-input').files[0];
}

function setDirtyFlag(e) {
	inputIsDirty = true;
}

function getInputFile() {
	return inputFile;
}

function getInputImage() {
	return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function getKeys() {
	return keys;
}

function getSizeOfNumberInBytes(number) {
	let sizeArr = [Uint8Array.BYTES_PER_ELEMENT, Uint16Array.BYTES_PER_ELEMENT, Uint32Array.BYTES_PER_ELEMENT];
	for(let i = 0; i < sizeArr.length; i += 1) {
		if (number < Math.pow(2, sizeArr[i] * BYTE_SIZE)) {
			return sizeArr[i];
		}			
	}
	
	return Number.MAX_SAFE_INTEGER;
}

function handleGoAction(e) {
	if (mode === 'encode') {
		steg(e);
	} else if (mode === 'decode') {
		desteg(e);
	} else {
		alert("Please select a mode");
		return;
	}
}

function handleModeChange() {
	mode = document.querySelector('input[name="mode"]:checked').value;
}

window.onload = function() {
	canvas = document.getElementById("js-image-canvas");
	ctx = canvas.getContext("2d");
	document.getElementById("js-file-input").addEventListener("change", handleFileInput, false);
	document.getElementById("js-image-input").addEventListener("change", writeImageToCanvas, false);
	document.getElementById("js-calculate-capacity").addEventListener("click", handleChannelCapacityCalcClick, false);
	document.getElementById("js-go-button").addEventListener("click", handleGoAction, false);
	document.getElementById("js-encode-radio").addEventListener("change", handleModeChange, false);
	
	//If any inputs are changed, set the inputIsDirty flag
	var inputs = document.getElementsByTagName("input");
	for (var i = 0; i < inputs.length; i += 1) {
		inputs[i].addEventListener("change", setDirtyFlag, false);
	}
}
