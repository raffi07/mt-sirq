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

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.AdapterView
import android.widget.AdapterView.OnItemSelectedListener
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CompoundButton
import android.widget.EditText
import android.widget.ImageView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import android.widget.ToggleButton
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.common.annotation.KeepName
import com.google.gson.Gson
import com.google.mlkit.vision.demo.CameraSource
import com.google.mlkit.vision.demo.CameraSourcePreview
import com.google.mlkit.vision.demo.GraphicOverlay
import com.google.mlkit.vision.demo.R
import com.google.mlkit.vision.demo.R.id.detectedText
import com.google.mlkit.vision.demo.kotlin.textdetector.TextRecognitionProcessor
import com.google.mlkit.vision.demo.preference.SettingsActivity
import com.google.mlkit.vision.demo.preference.SettingsActivity.LaunchSource
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Live preview demo for ML Kit APIs. */
@KeepName
class LivePreviewActivity :
  AppCompatActivity(), OnItemSelectedListener, CompoundButton.OnCheckedChangeListener {

  private var cameraSource: CameraSource? = null
  private var preview: CameraSourcePreview? = null
  private var graphicOverlay: GraphicOverlay? = null
  private var selectedModel = TEXT_RECOGNITION_LATIN
  private var textInputField : EditText? = null
  private var textViewField : TextView? = null
  private var ip : String? = null
  private var chargingStationId : String? = null
  private var apiEndpoint : String? = null
  private var chargerId : String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    Log.d(TAG, "onCreate")
    setContentView(R.layout.activity_vision_live_preview)

    preview = findViewById(R.id.preview_view)
    if (preview == null) {
      Log.d(TAG, "Preview is null")
    }

    graphicOverlay = findViewById(R.id.graphic_overlay)
    if (graphicOverlay == null) {
      Log.d(TAG, "graphicOverlay is null")
    }

    textInputField = findViewById(detectedText)
    if (textInputField == null) {
      Log.d(TAG, "textInputField is null")
    }

    textViewField = findViewById(R.id.detectedTextView)
    if (textViewField == null) {
      Log.d(TAG, "textViewField is null")
    }

    val spinner = findViewById<Spinner>(R.id.spinner)
    val options: MutableList<String> = ArrayList()
    options.add(TEXT_RECOGNITION_LATIN)


    // Creating adapter for spinner
    val dataAdapter = ArrayAdapter(this, R.layout.spinner_style, options)

    // Drop down layout style - list view with radio button
    dataAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
    // attaching data adapter to spinner
    spinner.adapter = dataAdapter
    spinner.onItemSelectedListener = this

    val facingSwitch = findViewById<ToggleButton>(R.id.facing_switch)
    facingSwitch.setOnCheckedChangeListener(this)

    val settingsButton = findViewById<ImageView>(R.id.settings_button)
    settingsButton.setOnClickListener {
      val intent = Intent(applicationContext, SettingsActivity::class.java)
      intent.putExtra(SettingsActivity.EXTRA_LAUNCH_SOURCE, LaunchSource.LIVE_PREVIEW)
      startActivity(intent)
    }

    createCameraSource(selectedModel)

    val apiButton = findViewById<Button>(R.id.sendToApiButtonVisionLivePreview)
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

  @Synchronized
  override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) {
    // An item was selected. You can retrieve the selected item using
    // parent.getItemAtPosition(pos)
    selectedModel = parent?.getItemAtPosition(pos).toString()
    Log.d(TAG, "Selected model: $selectedModel")
    preview?.stop()
    createCameraSource(selectedModel)
    startCameraSource()
  }

  override fun onNothingSelected(parent: AdapterView<*>?) {
    // Do nothing.
  }

  override fun onCheckedChanged(buttonView: CompoundButton, isChecked: Boolean) {
    Log.d(TAG, "Set facing")
    if (cameraSource != null) {
      if (isChecked) {
        cameraSource?.setFacing(CameraSource.CAMERA_FACING_FRONT)
      } else {
        cameraSource?.setFacing(CameraSource.CAMERA_FACING_BACK)
      }
    }
    preview?.stop()
    startCameraSource()
  }

  private fun createCameraSource(model: String) {
    // If there's no existing cameraSource, create one.
    if (cameraSource == null) {
      cameraSource = CameraSource(this, graphicOverlay)
    }
    try {
      when (model) {
        TEXT_RECOGNITION_LATIN -> {
          Log.i(TAG, "Using on-device Text recognition Processor for Latin and Latin")
          cameraSource!!.setMachineLearningFrameProcessor(
            TextRecognitionProcessor(this, TextRecognizerOptions.Builder().build(), textInputField, textViewField)
          )
        }
        else -> Log.e(TAG, "Unknown model: $model")
      }
    } catch (e: Exception) {
      Log.e(TAG, "Can not create image processor: $model", e)
      Toast.makeText(
          applicationContext,
          "Can not create image processor: " + e.message,
          Toast.LENGTH_LONG
        )
        .show()
    }
  }

  /**
   * Starts or restarts the camera source, if it exists. If the camera source doesn't exist yet
   * (e.g., because onResume was called before the camera source was created), this will be called
   * again when the camera source is created.
   */
  private fun startCameraSource() {
    if (cameraSource != null) {
      try {
        if (preview == null) {
          Log.d(TAG, "resume: Preview is null")
        }
        if (graphicOverlay == null) {
          Log.d(TAG, "resume: graphOverlay is null")
        }
        preview!!.start(cameraSource, graphicOverlay)
      } catch (e: IOException) {
        Log.e(TAG, "Unable to start camera source.", e)
        cameraSource!!.release()
        cameraSource = null
      }
    }
  }

  public override fun onResume() {
    super.onResume()
    Log.d(TAG, "onResume")
    createCameraSource(selectedModel)
    startCameraSource()
  }

  /** Stops the camera. */
  override fun onPause() {
    super.onPause()
    preview?.stop()
  }

  public override fun onDestroy() {
    super.onDestroy()
    if (cameraSource != null) {
      cameraSource?.release()
    }
  }
  fun setDetectedText(text: String){
    textInputField?.setText(text)
  }

  companion object {
    private const val TEXT_RECOGNITION_LATIN = "Text Recognition Latin"

    private const val TAG = "LivePreviewActivity"
  }
}
