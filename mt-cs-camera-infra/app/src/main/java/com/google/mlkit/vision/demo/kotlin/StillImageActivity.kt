/*
 * Copyright 2020 Google LLC. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.mlkit.vision.demo.kotlin

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.appcompat.app.AppCompatActivity
import android.util.Log
import android.util.Pair
import android.view.Gravity
import android.view.MenuItem
import android.view.View
import android.view.ViewTreeObserver
import android.widget.AdapterView
import android.widget.AdapterView.OnItemSelectedListener
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.PopupMenu
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.common.annotation.KeepName
import com.google.gson.Gson
import com.google.mlkit.vision.demo.BitmapUtils
import com.google.mlkit.vision.demo.GraphicOverlay
import com.google.mlkit.vision.demo.R
import com.google.mlkit.vision.demo.R.id.detectedText
import com.google.mlkit.vision.demo.VisionImageProcessor
import com.google.mlkit.vision.demo.kotlin.textdetector.TextRecognitionProcessor
import com.google.mlkit.vision.demo.preference.SettingsActivity
import com.google.mlkit.vision.demo.preference.SettingsActivity.LaunchSource
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.ArrayList
import kotlinx.coroutines.launch

/** Activity demonstrating different image detector features with a still image from camera. */
@KeepName
class StillImageActivity : AppCompatActivity() {
  private var preview: ImageView? = null
  private var graphicOverlay: GraphicOverlay? = null
  private var selectedMode = TEXT_RECOGNITION_LATIN
  private var selectedSize: String? = SIZE_SCREEN
  private var isLandScape = false
  private var imageUri: Uri? = null
  // Max width (portrait mode)
  private var imageMaxWidth = 0
  // Max height (portrait mode)
  private var imageMaxHeight = 0
  private var imageProcessor: VisionImageProcessor? = null
  private var textInputField : EditText? = null
  private var textViewField : TextView? = null
  private var ip : String? = null
  private var chargingStationId : String? = null
  private var apiEndpoint : String? = null
  private var chargerId : String? = null



  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_still_image)

    textInputField = findViewById(R.id.detectedText)

    if (textInputField == null) {
      Log.d(TAG, "textInputField is null")
    }

    textViewField = findViewById(R.id.detectedTextView)
    if (textViewField == null) {
      Log.d(TAG, "textViewField is null")
    }
    findViewById<View>(R.id.select_image_button).setOnClickListener { view: View ->
      // Menu for selecting either: a) take new photo b) select from existing
      val popup = PopupMenu(this@StillImageActivity, view)
      popup.setOnMenuItemClickListener { menuItem: MenuItem ->
        val itemId = menuItem.itemId
        if (itemId == R.id.select_images_from_local) {
          startChooseImageIntentForResult()
          return@setOnMenuItemClickListener true
        } else if (itemId == R.id.take_photo_using_camera) {
          startCameraIntentForResult()
          return@setOnMenuItemClickListener true
        }
        false
      }
      val inflater = popup.menuInflater
      inflater.inflate(R.menu.camera_button_menu, popup.menu)
      popup.show()
    }
    preview = findViewById(R.id.preview)
    graphicOverlay = findViewById(R.id.graphic_overlay)

    populateFeatureSelector()
    populateSizeSelector()
    isLandScape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    if (savedInstanceState != null) {
      imageUri = savedInstanceState.getParcelable(KEY_IMAGE_URI)
      imageMaxWidth = savedInstanceState.getInt(KEY_IMAGE_MAX_WIDTH)
      imageMaxHeight = savedInstanceState.getInt(KEY_IMAGE_MAX_HEIGHT)
      selectedSize = savedInstanceState.getString(KEY_SELECTED_SIZE)
    }

    val rootView = findViewById<View>(R.id.root)
    rootView.viewTreeObserver.addOnGlobalLayoutListener(
      object : ViewTreeObserver.OnGlobalLayoutListener {
        override fun onGlobalLayout() {
          rootView.viewTreeObserver.removeOnGlobalLayoutListener(this)
          imageMaxWidth = rootView.width
          imageMaxHeight = rootView.height - findViewById<View>(R.id.control).height
          if (SIZE_SCREEN == selectedSize) {
            tryReloadAndDetectInImage()
          }
        }
      }
    )

    val settingsButton = findViewById<ImageView>(R.id.settings_button)
    settingsButton.setOnClickListener {
      val intent = Intent(applicationContext, SettingsActivity::class.java)
      intent.putExtra(SettingsActivity.EXTRA_LAUNCH_SOURCE, LaunchSource.STILL_IMAGE)
      startActivity(intent)
    }

    val apiButton = findViewById<Button>(R.id.sendToApiButtonStillImage)
    apiButton.setOnClickListener {
      lifecycleScope.launch(Dispatchers.IO) {
        sendLicense()
      }
    }
  }

  private suspend fun sendLicense(){
    ip = intent.getStringExtra("ip")
    chargingStationId = intent.getStringExtra("chargingStationId")
    chargerId = intent.getStringExtra("chargerId")
    apiEndpoint = intent.getStringExtra("apiEndpoint")
    val licensePlateNumber = findViewById<EditText>(detectedText).text.toString()
    val loginUrlString = "http://$ip/api/login"
    val apiUrl = "http://$ip/api/$apiEndpoint"
    Log.d("APICALL", "Calling $loginUrlString")
    withContext(Dispatchers.IO){
      try {
        val url : URL = URI.create(apiUrl).toURL()
        val loginUrl : URL = URI.create(loginUrlString).toURL()
        val loginConnection :  HttpURLConnection = loginUrl.openConnection() as HttpURLConnection
        val connection : HttpURLConnection = url.openConnection() as HttpURLConnection
        val response = StringBuilder()

        loginConnection.requestMethod = "POST"

        // Send request body for POST/PUT methods
        loginConnection.doOutput = true
        val loginRequestBody = mapOf(
          "username" to "infra",
          "password" to "infra"
        )

        loginRequestBody.let {
          val jsonInput = Gson().toJson(it)
          OutputStreamWriter(loginConnection.outputStream).use { os ->
            os.write(jsonInput)
            os.flush()
          }
        }

        // Handle the response
        val loginResponseCode = loginConnection.responseCode
        val bearerToken = loginConnection.getHeaderField("set-cookie").split(';')[0].replace("bearerToken=", "Bearer ")
        if (loginResponseCode == HttpURLConnection.HTTP_OK || loginResponseCode == HttpURLConnection.HTTP_CREATED) {
          BufferedReader(InputStreamReader(loginConnection.inputStream, "utf-8")).use { br ->
            var responseLine: String?
            while (br.readLine().also { responseLine = it } != null) {
              response.append(responseLine?.trim())
            }
            Log.d("APICALL_LOGIN", response.toString())
//            Handler(Looper.getMainLooper()).post {
//              val toast = Toast.makeText(
//                applicationContext,
//                "Data sent successfully to API" + response.toString(),
//                Toast.LENGTH_LONG)
//              toast.setGravity(Gravity.CENTER, 0, 0)
//              toast.show()
//            }
          }
        } else {
          // Handle error response
          BufferedReader(InputStreamReader(loginConnection.errorStream, "utf-8")).use { br ->
            var responseLine: String?
            while (br.readLine().also { responseLine = it } != null) {
              response.append(responseLine?.trim())
            }
            Log.d("APICALL", response.toString())
          }
          println("Error Response Code: $loginResponseCode, Message: ${loginConnection.responseMessage}")
          Handler(Looper.getMainLooper()).post {
            val toast = Toast.makeText(
              applicationContext,
              "Error sending to API",
              Toast.LENGTH_LONG)
            toast.setGravity(Gravity.CENTER, 0, 0)
            toast.show()
          }
        }

        connection.requestMethod = "POST"

        // Send request body for POST/PUT methods
        connection.doOutput = true
        connection.setRequestProperty("Authorization", bearerToken);
        val requestBody = mapOf(
          "licensePlate" to licensePlateNumber,
          "chargingStationId" to chargingStationId,
          "chargerId" to chargerId
        )

        requestBody.let {
          val jsonInput = Gson().toJson(it)
          OutputStreamWriter(connection.outputStream).use { os ->
            os.write(jsonInput)
            os.flush()
          }
        }

        // Handle the response
        val responseCode = connection.responseCode
        if (responseCode == HttpURLConnection.HTTP_OK || responseCode == HttpURLConnection.HTTP_CREATED) {
          BufferedReader(InputStreamReader(connection.inputStream, "utf-8")).use { br ->
            var responseLine: String?
            while (br.readLine().also { responseLine = it } != null) {
              response.append(responseLine?.trim())
            }
            Log.d("APICALL", response.toString())
            Handler(Looper.getMainLooper()).post {
              val toast = Toast.makeText(
                applicationContext,
                "Data sent successfully to API" + response.toString(),
                Toast.LENGTH_LONG)
              toast.setGravity(Gravity.CENTER, 0, 0)
              toast.show()
            }
          }
        } else {
          // Handle error response
          BufferedReader(InputStreamReader(connection.errorStream, "utf-8")).use { br ->
            var responseLine: String?
            while (br.readLine().also { responseLine = it } != null) {
              response.append(responseLine?.trim())
            }
            Log.d("APICALL", response.toString())
          }
          println("Error Response Code: $responseCode, Message: ${connection.responseMessage}")
          Handler(Looper.getMainLooper()).post {
            val toast = Toast.makeText(
              applicationContext,
              "Error sending to API",
              Toast.LENGTH_LONG)
            toast.setGravity(Gravity.CENTER, 0, 0)
            toast.show()
          }
        }
      } catch (e: Exception) {
        e.printStackTrace()
      }
    }
  }

  public override fun onResume() {
    super.onResume()
    Log.d(TAG, "onResume")
    createImageProcessor()
    tryReloadAndDetectInImage()
  }

  public override fun onPause() {
    super.onPause()
    imageProcessor?.run { this.stop() }
  }

  public override fun onDestroy() {
    super.onDestroy()
    imageProcessor?.run { this.stop() }
  }

  private fun populateFeatureSelector() {
    val featureSpinner = findViewById<Spinner>(R.id.feature_selector)
    val options: MutableList<String> = ArrayList()
    options.add(TEXT_RECOGNITION_LATIN)

    // Creating adapter for featureSpinner
    val dataAdapter = ArrayAdapter(this, R.layout.spinner_style, options)
    // Drop down layout style - list view with radio button
    dataAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
    // attaching data adapter to spinner
    featureSpinner.adapter = dataAdapter
    featureSpinner.onItemSelectedListener =
      object : OnItemSelectedListener {
        override fun onItemSelected(
          parentView: AdapterView<*>,
          selectedItemView: View?,
          pos: Int,
          id: Long
        ) {
          if (pos >= 0) {
            selectedMode = parentView.getItemAtPosition(pos).toString()
            createImageProcessor()
            tryReloadAndDetectInImage()
          }
        }

        override fun onNothingSelected(arg0: AdapterView<*>?) {}
      }
  }

  private fun populateSizeSelector() {
    val sizeSpinner = findViewById<Spinner>(R.id.size_selector)
    val options: MutableList<String> = ArrayList()
    options.add(SIZE_SCREEN)
    options.add(SIZE_1024_768)
    options.add(SIZE_640_480)
    options.add(SIZE_ORIGINAL)
    // Creating adapter for featureSpinner
    val dataAdapter = ArrayAdapter(this, R.layout.spinner_style, options)
    // Drop down layout style - list view with radio button
    dataAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
    // attaching data adapter to spinner
    sizeSpinner.adapter = dataAdapter
    sizeSpinner.onItemSelectedListener =
      object : OnItemSelectedListener {
        override fun onItemSelected(
          parentView: AdapterView<*>,
          selectedItemView: View?,
          pos: Int,
          id: Long
        ) {
          if (pos >= 0) {
            selectedSize = parentView.getItemAtPosition(pos).toString()
            tryReloadAndDetectInImage()
          }
        }

        override fun onNothingSelected(arg0: AdapterView<*>?) {}
      }
  }

  public override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putParcelable(KEY_IMAGE_URI, imageUri)
    outState.putInt(KEY_IMAGE_MAX_WIDTH, imageMaxWidth)
    outState.putInt(KEY_IMAGE_MAX_HEIGHT, imageMaxHeight)
    outState.putString(KEY_SELECTED_SIZE, selectedSize)
  }

  private fun startCameraIntentForResult() { // Clean up last time's image
    imageUri = null
    preview!!.setImageBitmap(null)
    val takePictureIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
    if (takePictureIntent.resolveActivity(packageManager) != null) {
      val values = ContentValues()
      values.put(MediaStore.Images.Media.TITLE, "New Picture")
      values.put(MediaStore.Images.Media.DESCRIPTION, "From Camera")
      imageUri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
      takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, imageUri)
      startActivityForResult(takePictureIntent, REQUEST_IMAGE_CAPTURE)
    }
  }

  private fun startChooseImageIntentForResult() {
    val intent = Intent()
    intent.type = "image/*"
    intent.action = Intent.ACTION_GET_CONTENT
    startActivityForResult(Intent.createChooser(intent, "Select Picture"), REQUEST_CHOOSE_IMAGE)
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == REQUEST_IMAGE_CAPTURE && resultCode == Activity.RESULT_OK) {
      tryReloadAndDetectInImage()
    } else if (requestCode == REQUEST_CHOOSE_IMAGE && resultCode == Activity.RESULT_OK) {
      // In this case, imageUri is returned by the chooser, save it.
      imageUri = data!!.data
      tryReloadAndDetectInImage()
    } else {
      super.onActivityResult(requestCode, resultCode, data)
    }
  }

  private fun tryReloadAndDetectInImage() {
    Log.d(TAG, "Try reload and detect image")
    try {
      if (imageUri == null) {
        return
      }

      if (SIZE_SCREEN == selectedSize && imageMaxWidth == 0) {
        // UI layout has not finished yet, will reload once it's ready.
        return
      }

      val imageBitmap = BitmapUtils.getBitmapFromContentUri(contentResolver, imageUri) ?: return
      // Clear the overlay first
      graphicOverlay!!.clear()

      val resizedBitmap: Bitmap
      resizedBitmap =
        if (selectedSize == SIZE_ORIGINAL) {
          imageBitmap
        } else {
          // Get the dimensions of the image view
          val targetedSize: Pair<Int, Int> = targetedWidthHeight

          // Determine how much to scale down the image
          val scaleFactor =
            Math.max(
              imageBitmap.width.toFloat() / targetedSize.first.toFloat(),
              imageBitmap.height.toFloat() / targetedSize.second.toFloat()
            )
          Bitmap.createScaledBitmap(
            imageBitmap,
            (imageBitmap.width / scaleFactor).toInt(),
            (imageBitmap.height / scaleFactor).toInt(),
            true
          )
        }

      preview!!.setImageBitmap(resizedBitmap)
      if (imageProcessor != null) {
        graphicOverlay!!.setImageSourceInfo(
          resizedBitmap.width,
          resizedBitmap.height,
          /* isFlipped= */ false
        )
        imageProcessor!!.processBitmap(resizedBitmap, graphicOverlay)
      } else {
        Log.e(TAG, "Null imageProcessor, please check adb logs for imageProcessor creation error")
      }
    } catch (e: IOException) {
      Log.e(TAG, "Error retrieving saved image")
      imageUri = null
    }
  }

  private val targetedWidthHeight: Pair<Int, Int>
    get() {
      val targetWidth: Int
      val targetHeight: Int
      when (selectedSize) {
        SIZE_SCREEN -> {
          targetWidth = imageMaxWidth
          targetHeight = imageMaxHeight
        }
        SIZE_640_480 -> {
          targetWidth = if (isLandScape) 640 else 480
          targetHeight = if (isLandScape) 480 else 640
        }
        SIZE_1024_768 -> {
          targetWidth = if (isLandScape) 1024 else 768
          targetHeight = if (isLandScape) 768 else 1024
        }
        else -> throw IllegalStateException("Unknown size")
      }
      return Pair(targetWidth, targetHeight)
    }

  private fun createImageProcessor() {
    try {
      when (selectedMode) {
        TEXT_RECOGNITION_LATIN ->
          imageProcessor = TextRecognitionProcessor(this, TextRecognizerOptions.Builder().build(), textInputField, textViewField)
        else -> Log.e(TAG, "Unknown selectedMode: $selectedMode")
      }
    } catch (e: Exception) {
      Log.e(TAG, "Can not create image processor: $selectedMode", e)
      Toast.makeText(
          applicationContext,
          "Can not create image processor: " + e.message,
          Toast.LENGTH_LONG
        )
        .show()
    }
  }
  fun setDetectedText(text: String){
    textInputField?.setText(text)
  }

  companion object {
    private const val TAG = "StillImageActivity"
    private const val TEXT_RECOGNITION_LATIN = "Text Recognition Latin"
    private const val SIZE_SCREEN = "w:screen" // Match screen width
    private const val SIZE_1024_768 = "w:1024" // ~1024*768 in a normal ratio
    private const val SIZE_640_480 = "w:640" // ~640*480 in a normal ratio
    private const val SIZE_ORIGINAL = "w:original" // Original image size
    private const val KEY_IMAGE_URI = "com.google.mlkit.vision.demo.KEY_IMAGE_URI"
    private const val KEY_IMAGE_MAX_WIDTH = "com.google.mlkit.vision.demo.KEY_IMAGE_MAX_WIDTH"
    private const val KEY_IMAGE_MAX_HEIGHT = "com.google.mlkit.vision.demo.KEY_IMAGE_MAX_HEIGHT"
    private const val KEY_SELECTED_SIZE = "com.google.mlkit.vision.demo.KEY_SELECTED_SIZE"
    private const val REQUEST_IMAGE_CAPTURE = 1001
    private const val REQUEST_CHOOSE_IMAGE = 1002
  }
}
